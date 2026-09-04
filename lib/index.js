/**
 * Host half of the plugin.
 *
 * All interaction in this package lives in the DSH Web Client. Keeping the
 * host half empty means the plugin neither reads credentials nor changes the
 * agent loop, session log, or model configuration.
 */
export const name = 'dsh-harness-chat-control'

export function apply() {}
