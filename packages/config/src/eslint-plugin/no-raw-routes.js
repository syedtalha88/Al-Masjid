// CLAUDE.md §6: HTTP routes are declared only through defineRoute() (Zod validation, auth, rate limit,
// OpenAPI). Raw `router.get(...)`, `app.post(...)`, `router.route(...)` are rejected outside the file that
// implements defineRoute. `app.get('trust proxy')` (one argument = settings read) is allowed.
//
// Closing the name-only gap (Phase 00 re-review V-25):
// - creating an app or router — `express()`, `express.Router()`, `Router()` imported from express — is only allowed
//   where the option `allowCreate` is set (the app factory, tests), so no other code can hold a router at all;
// - verbs called directly on such a call (`express.Router().get(…)`) are raw routes;
// - with type information (the repo's type-aware lint), any value typed as an Express app or router counts,
//   whatever its variable is called (`r.get('/x', h)`).

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head', 'route']);

/** @param {string} name */
const isRouterLike = (name) => name === 'app' || /router$/i.test(name);

/** Type names of Express applications and routers (@types/express / express-serve-static-core). */
const EXPRESS_TYPE = /^(?:import\(.*\)\.)?(?:core\.)?(?:Express|Application|IRouter|Router)(?:<.*>)?$/;

/**
 * @param {import('estree').Node} node
 * @returns {boolean} true for `express()`, `express.Router(…)`, `Router(…)`
 */
function isFactoryCall(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name === 'express' || callee.name === 'Router';
  return (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'Router' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'express'
  );
}

/** @type {import('eslint').Rule.RuleModule} */
export const noRawRoutes = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow raw Express route registration; use defineRoute().' },
    schema: [
      {
        type: 'object',
        properties: { allowCreate: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      raw: '`{{object}}.{{verb}}(…)` registers a route without validation, auth, rate limits or OpenAPI. Use defineRoute().',
      create:
        'Express apps and routers are created only by the app factory (packages/api/src/app.ts); register routes with defineRoute().',
    },
  },
  create(context) {
    const allowCreate = Boolean(context.options[0]?.allowCreate);
    const services = context.sourceCode.parserServices;
    const typed = services?.program && services.esTreeNodeToTSNodeMap ? services : null;

    /** @param {import('estree').Node} node */
    const hasExpressType = (node) => {
      if (!typed) return false;
      const checker = typed.program.getTypeChecker();
      const type = checker.getTypeAtLocation(typed.esTreeNodeToTSNodeMap.get(node));
      const names = type.isUnion() ? type.types.map((t) => checker.typeToString(t)) : [checker.typeToString(type)];
      return names.some((name) => EXPRESS_TYPE.test(name));
    };

    return {
      CallExpression(node) {
        if (!allowCreate && isFactoryCall(node)) {
          context.report({ node, messageId: 'create' });
          return;
        }
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        const verb = callee.property.name;
        if (!VERBS.has(verb)) return;
        // app.get('setting') reads an Express setting; route registration always has ≥ 2 arguments.
        if (verb === 'get' && node.arguments.length < 2) return;

        const object = callee.object;
        const objectName =
          object.type === 'Identifier'
            ? object.name
            : object.type === 'MemberExpression' && object.property.type === 'Identifier'
              ? object.property.name
              : null;
        const routerLike =
          (objectName !== null && isRouterLike(objectName)) || isFactoryCall(object) || hasExpressType(object);
        if (!routerLike) return;
        context.report({ node, messageId: 'raw', data: { object: objectName ?? 'router', verb } });
      },
    };
  },
};
