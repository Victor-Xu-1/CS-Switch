// Only documented provider controls are translated. A generic endpoint is not
// identified by a model-name guess; exact official MiMo hosts are recognized for
// existing profiles saved before the preset existed.
export function providerKind(profile) {
  if (profile.provider !== 'openai-compatible') return profile.provider;
  try {
    if (['api.xiaomimimo.com', 'token-plan-cn.xiaomimimo.com', 'token-plan-global.xiaomimimo.com'].includes(new URL(profile.baseUrl).hostname)) return 'mimo';
  } catch { /* Profile validation owns malformed endpoints. */ }
  return profile.provider;
}
export function reasoningControls(input, profile) {
  const provider = providerKind(profile), enabled = Boolean(input.thinking?.type && input.thinking.type !== 'disabled');
  if (['deepseek', 'mimo'].includes(provider)) return { thinking: { type: enabled ? 'enabled' : 'disabled' } };
  if (provider === 'qwen') return input.thinking?.type ? { enable_thinking: enabled } : {};
  if (enabled) { const effort = input.output_config?.effort || 'medium'; return { reasoning_effort: effort === 'max' ? 'high' : effort }; }
  return {};
}
