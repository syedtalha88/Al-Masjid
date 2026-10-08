// Helpers shared by rules that inspect Tailwind class strings.

/**
 * @typedef {object} ClassVisitor
 * @property {(node: any) => void} JSXAttribute JSXAttribute nodes are not part of the estree types.
 * @property {(node: import('estree').CallExpression) => void} CallExpression
 * @property {(node: import('estree').Property) => void} Property
 */

/** Functions whose string arguments are treated as class lists. */
export const CLASS_FUNCTIONS = new Set(['cn', 'clsx', 'cx', 'cva', 'tw', 'twMerge', 'twJoin', 'classNames']);

/** JSX attributes / object keys whose string values are treated as class lists. */
export const CLASS_ATTRIBUTES = new Set(['className', 'class']);

/**
 * Splits a class string into utility names with variant prefixes (`hover:`, `md:`, `rtl:` …),
 * the important modifier (`!`) and the negative sign removed.
 * @param {string} value
 * @returns {{ raw: string, utility: string }[]}
 */
export function splitClasses(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const lastSegment = raw.slice(raw.lastIndexOf(':') + 1);
      const utility = lastSegment.replace(/^!/, '').replace(/!$/, '').replace(/^-/, '');
      return { raw, utility };
    });
}

/**
 * Calls `report(node, value)` for every string literal / template quasi that is used as a class list:
 * `className="…"`, `className={cn('…', cond && '…')}`, `{ className: '…' }`, `cva('…', { variants: … })`.
 * @param {(node: import('estree').Node, value: string) => void} report
 * @returns {ClassVisitor}
 */
export function visitClassStrings(report) {
  /** @param {import('estree').Node | null | undefined} node */
  const visit = (node) => {
    if (!node) return;
    switch (node.type) {
      case 'Literal':
        if (typeof node.value === 'string') report(node, node.value);
        return;
      case 'TemplateLiteral':
        for (const quasi of node.quasis) report(quasi, quasi.value.cooked ?? quasi.value.raw);
        for (const expression of node.expressions) visit(expression);
        return;
      case 'ConditionalExpression':
        visit(node.consequent);
        visit(node.alternate);
        return;
      case 'LogicalExpression':
        visit(node.right);
        if (node.operator !== '&&') visit(node.left);
        return;
      case 'ArrayExpression':
        for (const element of node.elements) if (element && element.type !== 'SpreadElement') visit(element);
        return;
      case 'ObjectExpression':
        // clsx({ 'ms-2': cond }) and cva variant maps: keys and values may both be class lists.
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          if (property.key.type === 'Literal') visit(property.key);
          visit(/** @type {import('estree').Node} */ (property.value));
        }
        return;
      // Calls to class functions are handled by the CallExpression listener below (wherever they appear),
      // so they are not visited here — otherwise `className={cn('…')}` would be reported twice.
      default:
        return;
    }
  };

  return {
    /** @param {any} node JSXAttribute (not part of the estree types) */
    JSXAttribute(node) {
      if (node.name?.type !== 'JSXIdentifier' || !CLASS_ATTRIBUTES.has(node.name.name)) return;
      const value = node.value;
      if (!value) return;
      if (value.type === 'Literal') visit(value);
      else if (value.type === 'JSXExpressionContainer') visit(value.expression);
    },
    CallExpression(node) {
      if (node.callee.type !== 'Identifier' || !CLASS_FUNCTIONS.has(node.callee.name)) return;
      for (const argument of node.arguments) if (argument.type !== 'SpreadElement') visit(argument);
    },
    Property(node) {
      const key = node.key.type === 'Identifier' ? node.key.name : node.key.type === 'Literal' ? node.key.value : null;
      if (typeof key === 'string' && CLASS_ATTRIBUTES.has(key))
        visit(/** @type {import('estree').Node} */ (node.value));
    },
  };
}
