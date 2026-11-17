/*
 * Guards for the new trees (`packages/kit/` and `ui-next/`).
 *
 * `no-static-style` is adapted from omniviewdev/ui `scripts/eslint/css-audit-rules.mjs` (`noInlineStyles`) at 65bbefb:
 * the old rule allowed any inline object whose keys were CSS variables, and a public `style` passthrough. Here a `style` is
 * allowed only as a data parameter: an object of custom properties whose values are computed. A static value is a class,
 * and there is no passthrough (strategy R7).
 */

const STATIC_NODE_TYPES = ['Literal'];

/** True when the expression can be evaluated without running the program: a literal, or an operator over literals. */
function isStatic(node) {
  if (node === undefined || node === null) return true;
  if (STATIC_NODE_TYPES.includes(node.type)) return true;
  if (node.type === 'TemplateLiteral') return node.expressions.length === 0;
  if (node.type === 'UnaryExpression') return isStatic(node.argument);
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') return isStatic(node.left) && isStatic(node.right);
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSNonNullExpression') {
    return isStatic(node.expression);
  }
  return false;
}

function unwrap(node) {
  let current = node;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSTypeAssertion' ||
    current?.type === 'TSSatisfiesExpression' ||
    current?.type === 'TSNonNullExpression'
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(property) {
  if (property.computed) return undefined;
  if (property.key.type === 'Literal') return String(property.key.value);
  if (property.key.type === 'Identifier') return property.key.name;
  return undefined;
}

export const noStaticStyle = {
  meta: {
    type: 'problem',
    docs: { description: 'Allow an inline style only as a data parameter: custom properties with computed values' },
    messages: {
      notObject:
        'A style is an inline object of custom properties with computed values (a data parameter). Anything else is a class in a CSS Module.',
      notCustomProperty:
        '"{{name}}" is not a custom property. An inline style carries data parameters only (`--name`); presentation is a CSS Module.',
      staticValue: '"{{name}}" has a static value. A value that does not change is a rule in a CSS Module, not an inline style.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') return;
        const container = node.value;
        if (container?.type !== 'JSXExpressionContainer') {
          context.report({ node, messageId: 'notObject' });
          return;
        }
        const expression = unwrap(container.expression);
        if (expression?.type !== 'ObjectExpression') {
          context.report({ node, messageId: 'notObject' });
          return;
        }
        for (const property of expression.properties) {
          if (property.type !== 'Property') {
            context.report({ node: property, messageId: 'notObject' });
            continue;
          }
          const name = propertyName(property);
          if (name === undefined || !name.startsWith('--')) {
            context.report({ node: property, messageId: 'notCustomProperty', data: { name: name ?? '[computed]' } });
          } else if (isStatic(unwrap(property.value))) {
            context.report({ node: property, messageId: 'staticValue', data: { name } });
          }
        }
      },
    };
  },
};

const RESTYLE_PROPS = ['className', 'style'];
const ATTRIBUTE_TYPE_PATTERN = /(?:HTML|DOM|SVG|Aria)Attributes|ComponentProps|HTMLProps/;

function heritageName(node) {
  const expression = node.expression ?? node.id;
  if (expression?.type === 'Identifier') return expression.name;
  if (expression?.type === 'TSQualifiedName') return expression.right.name;
  if (expression?.type === 'MemberExpression') return expression.property.name;
  return '';
}

/** In the kit: a part's props are closed. No `className`, no `style`, no HTML attribute types, no spread of unknown props onto the DOM. */
export const closedProps = {
  meta: {
    type: 'problem',
    docs: { description: 'Kit parts have closed props: no className, no style, no HTML attributes, no spread onto the DOM' },
    messages: {
      restyleProp:
        '"{{name}}" must not be a prop of a kit part. Parts are closed (strategy R7): a variant or a typed layout prop, or the plugin\'s own CSS Module.',
      attributeTypes:
        'A kit part must not take {{name}}: props are closed. Declare each prop; `data-*` passes through `dataAttributes()`.',
      spread:
        'Spreading props onto a DOM element lets a caller restyle the part. Only `dataAttributes(...)` may be spread.',
    },
    schema: [],
  },
  create(context) {
    return {
      TSPropertySignature(node) {
        const name = propertyName(node);
        if (name !== undefined && RESTYLE_PROPS.includes(name)) context.report({ node, messageId: 'restyleProp', data: { name } });
      },
      ObjectPattern(node) {
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const name = propertyName(property);
          if (name !== undefined && RESTYLE_PROPS.includes(name)) {
            context.report({ node: property, messageId: 'restyleProp', data: { name } });
          }
        }
      },
      TSInterfaceHeritage(node) {
        const name = heritageName(node);
        if (ATTRIBUTE_TYPE_PATTERN.test(name)) context.report({ node, messageId: 'attributeTypes', data: { name } });
      },
      TSExpressionWithTypeArguments(node) {
        const name = heritageName(node);
        if (ATTRIBUTE_TYPE_PATTERN.test(name)) context.report({ node, messageId: 'attributeTypes', data: { name } });
      },
      TSTypeReference(node) {
        const name = node.typeName.type === 'Identifier' ? node.typeName.name : node.typeName.right?.name ?? '';
        if (ATTRIBUTE_TYPE_PATTERN.test(name)) context.report({ node, messageId: 'attributeTypes', data: { name } });
      },
      JSXSpreadAttribute(node) {
        const argument = unwrap(node.argument);
        const sanctioned =
          argument?.type === 'CallExpression' && argument.callee.type === 'Identifier' && argument.callee.name === 'dataAttributes';
        if (!sanctioned) context.report({ node, messageId: 'spread' });
      },
    };
  },
};

/** In a consumer: a part imported from the kit takes no `className` and no `style`. The types already say so; this says why, and holds for `any`. */
export const noRestyle = {
  meta: {
    type: 'problem',
    docs: { description: 'Do not pass className or style to a component imported from @omniviewdev/kit' },
    messages: {
      restyle:
        '"{{name}}" cannot be passed to <{{component}}>: kit parts are closed (strategy R7). Use its variants and layout props, or put your own element and CSS Module around it.',
    },
    schema: [],
  },
  create(context) {
    const kitComponents = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@omniviewdev/kit') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') kitComponents.add(specifier.local.name);
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || !kitComponents.has(node.name.name)) return;
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier') continue;
          if (RESTYLE_PROPS.includes(attribute.name.name)) {
            context.report({ node: attribute, messageId: 'restyle', data: { name: attribute.name.name, component: node.name.name } });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: 'omniview-kit' },
  rules: {
    'no-static-style': noStaticStyle,
    'closed-props': closedProps,
    'no-restyle': noRestyle,
  },
};
