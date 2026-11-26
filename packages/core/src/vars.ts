/** Thrown by fillVars for a variable cycle. It holds the variable names of the cycle and never a value. */
export class VarCycleError extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(`variables ${names.join(', ')} use each other in a cycle`);
    this.name = 'VarCycleError';
    this.names = names;
  }
}

/**
 * Fills every {name} of a declared variable, then the {name}s in the inserted values, until none is left.
 * A {name} that is not an own key of vars stays as written.
 */
export function fillVars(text: string, vars: Record<string, string>): string {
  const done = new Map<string, string>();
  const fill = (value: string, stack: string[]): string =>
    value.replace(/\{(\w+)\}/g, (match, name: string) => {
      if (!Object.hasOwn(vars, name)) return match;
      const at = stack.indexOf(name);
      if (at >= 0) throw new VarCycleError(stack.slice(at));
      let filled = done.get(name);
      if (filled === undefined) {
        filled = fill(vars[name]!, [...stack, name]);
        done.set(name, filled);
      }
      return filled;
    });
  return fill(text, []);
}
