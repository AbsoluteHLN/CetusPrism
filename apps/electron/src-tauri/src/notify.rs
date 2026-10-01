//! Windows toast notifications through the pinned `windows` crate's WinRT
//! face — no new crates. A toast needs the process to carry an AppUserModelID
//! (`SetCurrentProcessExplicitAppUserModelID`) and that AUMID to resolve to a
//! display identity, which this module registers under HKCU; the toast itself
//! is a `ToastGeneric` XML document shown through
//! `ToastNotificationManager::CreateToastNotifierWithId`.

use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
use windows::Win32::Foundation::WIN32_ERROR;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
    REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

/// The toast identity, matching the packaged app identifier.
pub const AUMID: &str = "com.cetusprism.desktop";

/// HKCU key carrying the toast identity: display name (and optionally an icon)
/// so a portable or unpacked launch still shows a titled notification.
const REG_IDENTITY_SUBKEY: &str = "Software\\Classes\\AppUserModelId\\com.cetusprism.desktop";

/// Pin the toast identity onto this process; call once at boot.
pub fn set_app_user_model_id() {
    let id = HSTRING::from(AUMID);
    if let Err(error) = unsafe { SetCurrentProcessExplicitAppUserModelID(&id) } {
        eprintln!("[shell] AppUserModelID failed: {error}");
    }
}

/// Register the HKCU toast identity so toasts show the app's name even
/// without an installed start-menu shortcut. Failures only cost the toast's
/// app name, never the launch.
pub fn register_identity(display_name: &str) {
    let subkey = HSTRING::from(REG_IDENTITY_SUBKEY);
    let mut key = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &subkey,
            None,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut key,
            None,
        )
    };
    if status.is_err() {
        eprintln!("[shell] toast identity registration failed: {}", status.0);
        return;
    }
    let written = write_string_value(key, "DisplayName", display_name);
    if written.is_err() {
        eprintln!("[shell] toast DisplayName write failed: {}", written.unwrap_err().0);
    }
    let closed = unsafe { RegCloseKey(key) };
    if closed.is_err() {
        eprintln!("[shell] toast identity close failed: {}", closed.0);
    }
}

/// Write one REG_SZ value; `Err` carries the failing WIN32_ERROR.
fn write_string_value(key: HKEY, name: &str, value: &str) -> Result<(), WIN32_ERROR> {
    let value_name = HSTRING::from(name);
    let mut data = value.encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect::<Vec<u8>>();
    data.extend_from_slice(&[0, 0]); // the NUL terminator as two zero bytes
    let status = unsafe { RegSetValueExW(key, &value_name, None, REG_SZ, Some(&data)) };
    if status.is_ok() { Ok(()) } else { Err(status) }
}

/// Show one toast. Failures are logged, never fatal — a notification is a
/// convenience signal, not a product path.
pub fn show_toast(title: &str, body: &str) {
    let xml = format!(
        "<toast activationType=\"background\"><visual><binding template=\"ToastGeneric\">\
<text>{}</text><text>{}</text></binding></visual></toast>",
        escape_xml(title),
        escape_xml(body),
    );
    let document = match XmlDocument::new() {
        Ok(document) => document,
        Err(error) => {
            eprintln!("[shell] toast xml document failed: {error}");
            return;
        }
    };
    if let Err(error) = document.LoadXml(&HSTRING::from(xml)) {
        eprintln!("[shell] toast xml load failed: {error}");
        return;
    }
    let notifier = match ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID)) {
        Ok(notifier) => notifier,
        Err(error) => {
            eprintln!("[shell] toast notifier failed: {error}");
            return;
        }
    };
    let notification = match ToastNotification::CreateToastNotification(&document) {
        Ok(notification) => notification,
        Err(error) => {
            eprintln!("[shell] toast build failed: {error}");
            return;
        }
    };
    if let Err(error) = notifier.Show(&notification) {
        eprintln!("[shell] toast show failed: {error}");
    }
}

/// Escape one toast-text fragment for its XML document.
fn escape_xml(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

#[cfg(test)]
mod toast_tests {
    use super::escape_xml;

    #[test]
    fn escapes_xml_metacharacters() {
        assert_eq!(escape_xml("a<b&c>d\"e'f"), "a&lt;b&amp;c&gt;d&quot;e&apos;f");
        assert_eq!(escape_xml("任务完成"), "任务完成");
        assert_eq!(escape_xml(""), "");
    }
}
