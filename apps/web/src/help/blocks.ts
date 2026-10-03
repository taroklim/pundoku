/** Блоки экрана «How Pundoku works» (PD-120). Идентификатор — якорь в адресе (`#/help/technique`) и ключ в i18n (`help.<id>`). */
export const HELP_BLOCKS = ["grid", "fixes", "technique", "hints", "year", "counter"] as const;
export type HelpBlockId = (typeof HELP_BLOCKS)[number];

export function isHelpBlock(value: string | undefined): value is HelpBlockId {
  return value !== undefined && (HELP_BLOCKS as readonly string[]).includes(value);
}
