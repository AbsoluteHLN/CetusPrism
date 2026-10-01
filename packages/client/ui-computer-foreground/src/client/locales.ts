/** Locale-owned computer-use delivery toggle copy. */
export const zh = {
  'state.allow': '允许抢前台',
  'state.blocked': '禁止抢前台',
  'description': '控制计算机操作是否允许切换到目标窗口的前台。禁止后，助手只通过后台通道操作应用。',
  'error.sessionInUse': '当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。',
  'error.submit': '抢前台设置失败：{message}',
} satisfies Record<string, string>

/** Computer-use delivery dictionary key union. */
export type DeliveryForegroundKey = keyof typeof zh

/** English dictionary with the same keys. */
export const en = {
  'state.allow': 'Foreground allowed',
  'state.blocked': 'Foreground blocked',
  'description': 'Whether computer actions may bring the target window to the foreground. When blocked, the assistant drives apps through background delivery only.',
  'error.sessionInUse': 'This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.',
  'error.submit': 'Foreground switch failed: {message}',
} satisfies Record<DeliveryForegroundKey, string>
