/** Server credentials must never be inherited by interactive shells or agents. */
export function runtimeEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => !key.startsWith('YAMIDE_') && value !== undefined,
    ),
  ) as Record<string, string>;
}
