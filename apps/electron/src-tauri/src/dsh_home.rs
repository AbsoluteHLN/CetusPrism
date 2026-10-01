//! DeepSeek Harness home detection and transfer for the desktop shell.
//!
//! Rust port of the fork's `dsh-home.ts`: the backend resolves its user-data
//! root through `$DSH_HOME` (defaulting to `~/.dsh`), so pointing the shell at
//! an existing home only requires setting that variable on the backend spawn.
//! On first launch the shell detects an existing home, records the user's
//! decision in the shell's user-data directory, and — when the user chooses
//! transfer — copies the home to a folder they pick. A transfer is a copy: the
//! shell never modifies or deletes the original home.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Environment variable that overrides the default DeepSeek Harness home.
pub const DSH_HOME_ENV: &str = "DSH_HOME";

/// Directory name of the default DeepSeek Harness home under the OS home.
pub const DSH_HOME_DIR_NAME: &str = ".dsh";

/// Home entries whose presence marks a home as holding existing user data.
const HOME_MARKERS: [&str; 5] = [
    ".credentials.yaml",
    "settings.yaml",
    "profiles",
    "sessions",
    "storages",
];

/// Installer-written hint file (see `build/installer.nsh`); lives in user data.
pub const INSTALL_HINT_FILE: &str = "install-detected-dsh-home.ini";

/// Shell-side decision file; lives in user data.
pub const DECISION_FILE: &str = "dsh-home.json";

/// An existing harness home found on this machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DshHomeCandidate {
    /// Absolute path of the detected home.
    pub path: PathBuf,
    /// Where the detection came from.
    pub source: DshHomeSource,
}

/// Where a detected home came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DshHomeSource {
    /// The user environment pointed at it.
    Env,
    /// It is the default home holding user data.
    Default,
    /// The installer wrote a hint about it.
    InstallerHint,
}

/// The user's recorded home choice; persists so the prompt runs once per install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DshHomeDecision {
    /// Decision schema version.
    pub version: u32,
    /// `custom` pins `DSH_HOME` to `home`; `default` keeps default resolution.
    pub mode: DshHomeMode,
    /// Absolute home path, present when mode is custom.
    pub home: Option<PathBuf>,
    /// Home the previous decision pointed at, offered as a boot-failure fallback.
    pub fallback_home: Option<PathBuf>,
    /// ISO-8601 UTC timestamp of the decision.
    pub decided_at: String,
}

/// The recorded decision mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DshHomeMode {
    /// Keep default resolution (`$DSH_HOME` env or `~/.dsh`).
    Default,
    /// Pin the backend home to the recorded path.
    Custom,
}

/// Default harness home (`~/.dsh`; `%USERPROFILE%\.dsh` on Windows).
pub fn default_dsh_home() -> PathBuf {
    let profile = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    Path::new(&profile).join(DSH_HOME_DIR_NAME)
}

/// Whether a directory holds existing harness user data.
pub fn holds_user_data(home: &Path) -> bool {
    HOME_MARKERS.iter().any(|marker| home.join(marker).exists())
}

/// Detect an existing harness home for the first-run inheritance prompt.
pub fn detect_existing_dsh_home() -> Option<DshHomeCandidate> {
    let from_env = std::env::var(DSH_HOME_ENV).unwrap_or_default();
    detect_from(&from_env, &default_dsh_home())
}

/// Detection core with injectable inputs so tests exercise the real rules.
fn detect_from(env_value: &str, default_home: &Path) -> Option<DshHomeCandidate> {
    let from_env = env_value.trim();
    if !from_env.is_empty() {
        let home = PathBuf::from(from_env);
        return holds_user_data(&home).then_some(DshHomeCandidate { path: home, source: DshHomeSource::Env });
    }
    holds_user_data(default_home)
        .then_some(DshHomeCandidate { path: default_home.to_path_buf(), source: DshHomeSource::Default })
}

/// Read the installer's detection hint, written by `customInstall` in
/// `build/installer.nsh`. NSIS `WriteINIStr` writes ANSI for a new file and
/// UTF-16LE when updating an existing Unicode file, so both are accepted.
/// The hint is advisory: callers must re-verify the path before offering it.
pub fn read_install_hint(user_data_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read(user_data_dir.join(INSTALL_HINT_FILE)).ok()?;
    let utf16 = raw.len() >= 2 && raw[0] == 0xff && raw[1] == 0xfe;
    let text = if utf16 {
        let units: Vec<u16> = raw[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16(&units).ok()?
    } else {
        String::from_utf8(raw).ok()?
    };
    let found = ini_value(&text, "found")?;
    let path = ini_value(&text, "path")?;
    if (found != "env" && found != "default") || path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

/// Read one `key=value` entry from the INI-shaped hint file.
fn ini_value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (name, value) = line.trim().split_once('=')?;
        (name.trim() == key).then(|| value.trim().to_string())
    })
}

/// Read the recorded home decision; `None` when absent or malformed.
pub fn read_decision(user_data_dir: &Path) -> Option<DshHomeDecision> {
    let raw = std::fs::read_to_string(user_data_dir.join(DECISION_FILE)).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if parsed.get("version")?.as_u64()? != 1 {
        return None;
    }
    let mode = match parsed.get("mode")?.as_str()? {
        "default" => DshHomeMode::Default,
        "custom" => DshHomeMode::Custom,
        _ => return None,
    };
    Some(DshHomeDecision {
        version: 1,
        mode,
        home: parsed.get("home").and_then(|value| value.as_str()).map(PathBuf::from),
        fallback_home: parsed.get("fallbackHome").and_then(|value| value.as_str()).map(PathBuf::from),
        decided_at: parsed.get("decidedAt").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
    })
}

/// Record the home decision so the first-run prompt does not run again.
pub fn write_decision(user_data_dir: &Path, mode: DshHomeMode, home: Option<&Path>, fallback_home: Option<&Path>) {
    let decision = serde_json::json!({
        "version": 1,
        "mode": match mode { DshHomeMode::Default => "default", DshHomeMode::Custom => "custom" },
        "home": home.map(|path| path.to_string_lossy()),
        "fallbackHome": fallback_home.map(|path| path.to_string_lossy()),
        "decidedAt": iso8601_now(),
    });
    let text = serde_json::to_string_pretty(&decision).expect("decision JSON serializes") + "\n";
    std::fs::write(user_data_dir.join(DECISION_FILE), text).expect("decision file is writable");
}

/// Copy an existing harness home to a new folder.
///
/// The install-specific `profiles/node_modules` link projection is excluded:
/// its junctions point at the installation that created them, and the harness
/// re-materializes that directory against the running installation at each
/// boot. Everything else copies verbatim; directory junctions and symlinks
/// recreate as links. The destination must not exist or must be empty, and
/// the source is never modified.
pub fn copy_dsh_home(source_home: &Path, destination_home: &Path) -> Result<(), String> {
    if destination_home.exists() && std::fs::read_dir(destination_home).is_ok_and(|mut entries| entries.next().is_some()) {
        return Err(format!("目标文件夹不是空的：{}", destination_home.display()));
    }
    let link_projection = source_home.join("profiles").join("node_modules");
    copy_tree(source_home, destination_home, &link_projection).map_err(|error| format!("复制配置失败：{error}"))?;
    if !holds_user_data(destination_home) {
        return Err("复制后未在新文件夹找到任何配置内容".into());
    }
    Ok(())
}

/// Recursively copy `source` into `destination`, skipping `excluded` and its
/// descendants. Files and real directories copy as data; symlinks and
/// junctions recreate as links pointing at their recorded targets.
fn copy_tree(source: &Path, destination: &Path, excluded: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path == excluded || entry_path.starts_with(excluded) {
            continue;
        }
        let destination_path = destination.join(entry.file_name());
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            copy_tree(&entry_path, &destination_path, excluded)?;
        } else if metadata.is_symlink() {
            recreate_link(&entry_path, &destination_path)?;
        } else {
            std::fs::copy(&entry_path, &destination_path)?;
        }
    }
    Ok(())
}

/// Recreate one directory junction or file symlink under the destination.
fn recreate_link(link: &Path, destination_link: &Path) -> std::io::Result<()> {
    let target = std::fs::read_link(link)?;
    let target = if target.is_absolute() {
        target
    } else {
        link.parent().unwrap_or(Path::new("/")).join(target)
    };
    #[cfg(windows)]
    {
        if target.is_dir() {
            std::os::windows::fs::symlink_dir(&target, destination_link)
        } else {
            std::os::windows::fs::symlink_file(&target, destination_link)
        }
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(&target, destination_link)
    }
}

/// Current UTC time as an ISO-8601 string, without pulling a time crate.
fn iso8601_now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let rem = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

/// Days since the Unix epoch to a civil (year, month, day) date.
/// Howard Hinnant's `civil_from_days` algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if month <= 2 { y + 1 } else { y }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh scratch directory unique to one test run.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dsh-home-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir creates");
        dir
    }

    #[test]
    fn default_home_counts_only_with_user_data() {
        let home = scratch("default");
        assert_eq!(detect_from("", &home), None);
        std::fs::write(home.join("settings.yaml"), "{}").unwrap();
        let detected = detect_from("", &home).expect("marker present");
        assert_eq!(detected.source, DshHomeSource::Default);
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn env_home_wins_and_requires_markers() {
        let bare = scratch("env-bare");
        assert_eq!(detect_from(bare.to_str().unwrap(), Path::new("C:\\nowhere")), None);
        std::fs::write(bare.join(".credentials.yaml"), "x: 1").unwrap();
        let detected = detect_from(bare.to_str().unwrap(), Path::new("C:\\elsewhere")).expect("env home detected");
        assert_eq!(detected.source, DshHomeSource::Env);
        std::fs::remove_dir_all(&bare).unwrap();
    }

    #[test]
    fn install_hint_parses_both_encodings() {
        let dir = scratch("hint");
        std::fs::write(dir.join(INSTALL_HINT_FILE), "found=default\r\npath=C:\\Users\\t\\.dsh\r\n").unwrap();
        assert_eq!(read_install_hint(&dir), Some(PathBuf::from("C:\\Users\\t\\.dsh")));

        let text: Vec<u16> = "found=env\r\npath=E:\\my home\r\n".encode_utf16().collect();
        let mut bytes = vec![0xff, 0xfe];
        for unit in text {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        std::fs::write(dir.join(INSTALL_HINT_FILE), bytes).unwrap();
        assert_eq!(read_install_hint(&dir), Some(PathBuf::from("E:\\my home")));

        std::fs::write(dir.join(INSTALL_HINT_FILE), "found=other\r\npath=C:\\x\r\n").unwrap();
        assert_eq!(read_install_hint(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn decision_round_trips() {
        let dir = scratch("decision");
        assert_eq!(read_decision(&dir), None);
        std::fs::write(dir.join(DECISION_FILE), "not json").unwrap();
        assert_eq!(read_decision(&dir), None);
        write_decision(&dir, DshHomeMode::Custom, Some(Path::new("E:\\h")), Some(Path::new("C:\\h")));
        let decision = read_decision(&dir).expect("written decision reads back");
        assert_eq!(decision.mode, DshHomeMode::Custom);
        assert_eq!(decision.home, Some(PathBuf::from("E:\\h")));
        assert_eq!(decision.fallback_home, Some(PathBuf::from("C:\\h")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copy_excludes_link_projection_and_requires_empty_destination() {
        let source = scratch("copy-src");
        let destination = scratch("copy-dst");
        std::fs::write(source.join("settings.yaml"), "{}").unwrap();
        std::fs::create_dir_all(source.join("profiles").join("node_modules").join("kept-dep")).unwrap();
        std::fs::write(source.join("profiles").join("package.json"), "{}").unwrap();
        copy_dsh_home(&source, &destination).expect("copy succeeds");
        assert!(destination.join("settings.yaml").exists());
        assert!(destination.join("profiles").join("package.json").exists());
        assert!(!destination.join("profiles").join("node_modules").exists());

        // A second copy into the now non-empty destination is refused.
        assert!(copy_dsh_home(&source, &destination).is_err());
        std::fs::remove_dir_all(&source).unwrap();
        std::fs::remove_dir_all(&destination).unwrap();
    }

    #[test]
    fn iso_timestamp_is_well_formed() {
        let stamp = iso8601_now();
        assert_eq!(stamp.len(), 20);
        assert!(stamp.ends_with('Z'));
        assert_eq!(&stamp[4..5], "-");
    }
}
