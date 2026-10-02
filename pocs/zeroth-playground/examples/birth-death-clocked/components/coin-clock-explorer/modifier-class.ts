/** A BEM class with its modifier when there is one: "block block--modifier", or "block". */
export function modifierClass(block: string, modifier: string | undefined): string {
  return modifier === undefined ? block : `${block} ${block}--${modifier}`;
}
