const EXPORT_TYPE =
  /(?:^|\n)\s*export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu;

/** Collects exported `interface` / `type` names from TypeScript source. */
export function collectExportedTypeNames(source: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(EXPORT_TYPE)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Names from generated output that already exist in the target file.
 * Empty means insertion would not collide on exported type names.
 */
export function collidingGeneratedTypeNames(
  generatedDeclarationNames: readonly string[],
  existingSource: string,
): readonly string[] {
  const existing = collectExportedTypeNames(existingSource);
  return generatedDeclarationNames.filter((name) => existing.has(name));
}

/**
 * Builds insertion text that keeps a blank line between existing code and
 * generated declarations. Does not modify the existing source.
 */
export function prepareGeneratedTypeInsertion(
  existingSource: string,
  generatedCode: string,
): string {
  const generated = generatedCode.trim();
  if (existingSource.trim().length === 0) {
    return `${generated}\n`;
  }
  const prefix = existingSource.endsWith('\n')
    ? existingSource
    : `${existingSource}\n`;
  const spacer = prefix.endsWith('\n\n') ? '' : '\n';
  return `${prefix}${spacer}${generated}\n`;
}
