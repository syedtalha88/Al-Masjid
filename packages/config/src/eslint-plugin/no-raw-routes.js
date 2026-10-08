// CLAUDE.md §6: HTTP routes are declared only through defineRoute() (Zod validation, auth, rate limit,
// OpenAPI). Raw `router.get(...)`, `app.post(...)`, `router.route(...)` are rejected outside the file that
// implements defineRoute. `app.get('trust proxy')` (one argument = settings read) is allowed.

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head', 'route']);

/** @param {string} name */
const isRouterLike = (name) => name === 'app' || /router$/i.test(name);

/** @type {import('eslint').Rule.RuleModule} */
export const noRawRoutes = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow raw Express route registration; use defineRoute().' },
    schema: [],
    messages: {
      raw: '`{{object}}.{{verb}}(…)` registers a route without validation, auth, rate limits or OpenAPI. Use defineRoute().',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        const verb = callee.property.name;
        if (!VERBS.has(verb)) return;

        const object = callee.object;
        const objectName =
          object.type === 'Identifier'
            ? object.name
            : object.type === 'MemberExpression' && object.property.type === 'Identifier'
              ? object.property.name
              : null;
        if (!objectName || !isRouterLike(objectName)) return;

        // app.get('setting') reads an Express setting; route registration always has ≥ 2 arguments.
        if (verb === 'get' && node.arguments.length < 2) return;

        context.report({ node, messageId: 'raw', data: { object: objectName, verb } });
      },
    };
  },
};
