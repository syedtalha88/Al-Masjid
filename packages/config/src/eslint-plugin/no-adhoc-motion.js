import { splitClasses, visitClassStrings } from './class-strings.js';

// 08 §0/§2: all durations, delays, springs and easings come from the presets in packages/ui/src/motion.
// Outside that folder, numeric literals inside a `transition` value, in timing options passed to
// `animate()`, or Tailwind timing utilities (`duration-300`, `delay-75`, `ease-[…]`) are rejected.

const TIMING_KEYS = new Set([
  'duration',
  'delay',
  'visualDuration',
  'bounce',
  'stiffness',
  'damping',
  'mass',
  'velocity',
  'restDelta',
  'restSpeed',
  'repeatDelay',
  'ease',
]);

const TIMING_UTILITY = /^(duration|delay)-(\d|\[)|^ease-\[/;

/**
 * Finds the first numeric literal anywhere inside `node` (objects, arrays, unary minus).
 * @param {import('estree').Node} node
 * @returns {import('estree').Node | null}
 */
function findNumericLiteral(node) {
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'number' ? node : null;
    case 'UnaryExpression':
      return findNumericLiteral(node.argument);
    case 'ArrayExpression':
      for (const element of node.elements) {
        if (!element || element.type === 'SpreadElement') continue;
        const found = findNumericLiteral(element);
        if (found) return found;
      }
      return null;
    case 'ObjectExpression':
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        const found = findNumericLiteral(/** @type {import('estree').Node} */ (property.value));
        if (found) return found;
      }
      return null;
    default:
      return null;
  }
}

/**
 * Finds a timing key (`duration`, `ease`, …) with a numeric value directly in an options object.
 * @param {import('estree').Node} node
 * @returns {import('estree').Node | null}
 */
function findTimingOption(node) {
  if (node.type !== 'ObjectExpression') return null;
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.key.type !== 'Identifier') continue;
    if (!TIMING_KEYS.has(property.key.name)) continue;
    const found = findNumericLiteral(/** @type {import('estree').Node} */ (property.value));
    if (found) return found;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noAdhocMotion = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow ad-hoc animation timings outside packages/ui/src/motion.' },
    schema: [],
    messages: {
      adhoc:
        'Ad-hoc animation timing. Use a preset from @mc/ui/motion (spring.*, tween.*, css.ios) instead (08_MOTION §2).',
      adhocClass:
        '"{{raw}}" sets an ad-hoc animation timing. Use a motion preset from @mc/ui/motion instead (08_MOTION §2).',
    },
  },
  create(context) {
    /** @param {import('estree').Node} valueNode */
    const checkTransitionValue = (valueNode) => {
      const found = findNumericLiteral(valueNode);
      if (found) context.report({ node: found, messageId: 'adhoc' });
    };

    const classVisitor = visitClassStrings((node, value) => {
      for (const { raw, utility } of splitClasses(value)) {
        if (TIMING_UTILITY.test(utility)) context.report({ node, messageId: 'adhocClass', data: { raw } });
      }
    });

    return {
      ...classVisitor,
      // { transition: { duration: 0.3 } } / variants
      Property(node) {
        classVisitor.Property(node);
        const key = node.key.type === 'Identifier' ? node.key.name : null;
        if (key === 'transition') checkTransitionValue(/** @type {import('estree').Node} */ (node.value));
      },
      /** @param {any} node JSXAttribute — <m.div transition={{ duration: 0.3 }} /> */
      JSXAttribute(node) {
        classVisitor.JSXAttribute(node);
        if (node.name?.name !== 'transition' || node.value?.type !== 'JSXExpressionContainer') return;
        checkTransitionValue(node.value.expression);
      },
      // animate(value, target, { duration: 0.3 }) / animate(el, keyframes, { ease: [..] })
      CallExpression(node) {
        classVisitor.CallExpression(node);
        const callee = node.callee;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : null;
        if (name !== 'animate') return;
        for (const argument of node.arguments) {
          if (argument.type === 'SpreadElement') continue;
          const found = findTimingOption(argument);
          if (found) context.report({ node: found, messageId: 'adhoc' });
        }
      },
    };
  },
};
