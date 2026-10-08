import { splitClasses, visitClassStrings } from './class-strings.js';

// Physical-direction Tailwind utilities and their logical replacements (09 §5, CLAUDE.md §6 UI).
// Urdu is RTL, so layout must use logical properties only.
/** @type {[RegExp, string][]} */
const PHYSICAL_UTILITIES = [
  [/^ml(-|$)/, 'ms-*'],
  [/^mr(-|$)/, 'me-*'],
  [/^pl(-|$)/, 'ps-*'],
  [/^pr(-|$)/, 'pe-*'],
  [/^left(-|$)/, 'start-*'],
  [/^right(-|$)/, 'end-*'],
  [/^border-l(-|$)/, 'border-s-*'],
  [/^border-r(-|$)/, 'border-e-*'],
  [/^rounded-l(-|$)/, 'rounded-s-*'],
  [/^rounded-r(-|$)/, 'rounded-e-*'],
  [/^rounded-tl(-|$)/, 'rounded-ss-*'],
  [/^rounded-tr(-|$)/, 'rounded-se-*'],
  [/^rounded-bl(-|$)/, 'rounded-es-*'],
  [/^rounded-br(-|$)/, 'rounded-ee-*'],
  [/^scroll-m[lr](-|$)/, 'scroll-ms-* / scroll-me-*'],
  [/^scroll-p[lr](-|$)/, 'scroll-ps-* / scroll-pe-*'],
  [/^text-(left|right)$/, 'text-start / text-end'],
  [/^float-(left|right)$/, 'float-start / float-end'],
  [/^clear-(left|right)$/, 'clear-start / clear-end'],
];

// Physical CSS properties in `style` objects and their logical replacements.
const PHYSICAL_STYLE_PROPERTIES = new Map([
  ['marginLeft', 'marginInlineStart'],
  ['marginRight', 'marginInlineEnd'],
  ['paddingLeft', 'paddingInlineStart'],
  ['paddingRight', 'paddingInlineEnd'],
  ['left', 'insetInlineStart'],
  ['right', 'insetInlineEnd'],
  ['borderLeft', 'borderInlineStart'],
  ['borderRight', 'borderInlineEnd'],
  ['borderLeftWidth', 'borderInlineStartWidth'],
  ['borderRightWidth', 'borderInlineEndWidth'],
  ['borderTopLeftRadius', 'borderStartStartRadius'],
  ['borderTopRightRadius', 'borderStartEndRadius'],
  ['borderBottomLeftRadius', 'borderEndStartRadius'],
  ['borderBottomRightRadius', 'borderEndEndRadius'],
]);

/** @type {import('eslint').Rule.RuleModule} */
export const noPhysicalDirection = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow physical-direction (left/right) classes and styles; use logical properties for RTL.',
    },
    schema: [],
    messages: {
      physicalClass:
        '"{{raw}}" is a physical-direction class. Use {{replacement}} so the layout mirrors in Urdu (RTL).',
      physicalStyle:
        '`{{property}}` is a physical-direction style. Use `{{replacement}}` so the layout mirrors in Urdu (RTL).',
      physicalTextAlign: "textAlign '{{value}}' does not mirror in RTL. Use 'start' or 'end'.",
    },
  },
  create(context) {
    const classVisitor = visitClassStrings((node, value) => {
      for (const { raw, utility } of splitClasses(value)) {
        const match = PHYSICAL_UTILITIES.find(([pattern]) => pattern.test(utility));
        if (match) context.report({ node, messageId: 'physicalClass', data: { raw, replacement: match[1] } });
      }
    });

    return {
      ...classVisitor,
      /** @param {any} node JSXAttribute */
      JSXAttribute(node) {
        classVisitor.JSXAttribute(node);
        if (node.name?.name !== 'style' || node.value?.type !== 'JSXExpressionContainer') return;
        const expression = node.value.expression;
        if (expression.type !== 'ObjectExpression') return;
        for (const property of expression.properties) {
          if (property.type !== 'Property' || property.key.type !== 'Identifier') continue;
          const name = property.key.name;
          const replacement = PHYSICAL_STYLE_PROPERTIES.get(name);
          if (replacement) {
            context.report({ node: property, messageId: 'physicalStyle', data: { property: name, replacement } });
          } else if (
            name === 'textAlign' &&
            property.value.type === 'Literal' &&
            (property.value.value === 'left' || property.value.value === 'right')
          ) {
            context.report({ node: property, messageId: 'physicalTextAlign', data: { value: property.value.value } });
          }
        }
      },
    };
  },
};
