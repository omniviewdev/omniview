import { Document, isMap, isSeq, isScalar, parseDocument, type ScalarTag } from 'yaml';
import { jsonToValue, valueToJSON, type Value } from '@omniviewdev/runtime';

/** Use YAML's native float tag, including for integral doubles and negative zero. */
export function resourceYaml(value: Value): string {
  const document = new Document(valueToJSON(value), {
    customTags: (tags) => tags.map((tag) => {
      if (typeof tag === 'string' || tag.tag !== 'tag:yaml.org,2002:float' || !tag.stringify) {
        return tag;
      }

      const stringify = tag.stringify;
      const floatTag: ScalarTag = {
        ...tag,
        stringify: (item, context, onComment, onChompKeep) => Object.is(item.value, -0)
          ? '-0.0'
          : stringify(item, context, onComment, onChompKeep),
      };
      return floatTag;
    }),
  });
  const annotate = (node: unknown, source: Value): void => {
    if (source.kind === 'double' && isScalar(node)) {
      node.tag = 'tag:yaml.org,2002:float';
      node.minFractionDigits = 1;
    } else if (source.kind === 'map' && isMap(node)) {
      for (const pair of node.items) {
        if (isScalar(pair.key)) {
          annotate(pair.value, source.value[String(pair.key.value)]);
        }
      }
    } else if (source.kind === 'list' && isSeq(node)) {
      node.items.forEach((child, index) => {
        annotate(child, source.value[index]);
      });
    }
  };

  annotate(document.contents, value);
  return document.toString();
}

/** Retain exact original kinds for untouched scalars, not merely equal JS numbers. */
export function parseResourceYaml(text: string, original: Value, originalText: string): Value {
  const document = parseDocument(text, { intAsBigInt: true, uniqueKeys: true });
  const baseline = parseDocument(originalText, { intAsBigInt: true });
  if (document.errors.length) {
    throw document.errors[0];
  }

  const convert = (node: unknown, prior: Value | undefined, oldNode: unknown): Value => {
    if (isScalar(node)) {
      if (prior && isScalar(oldNode) && node.source === oldNode.source && node.tag === oldNode.tag && node.type === oldNode.type) {
        return prior;
      }

      if (node.tag === 'tag:yaml.org,2002:float' || typeof node.value === 'number') {
        if (!Number.isFinite(node.value)) {
          throw new Error('Resource doubles must be finite.');
        }

        return { kind: 'double', value: node.value as number };
      }

      return jsonToValue(node.value);
    }

    if (isSeq(node)) {
      return { kind: 'list', value: node.items.map((item, index) => convert(item, prior?.kind === 'list' ? prior.value[index] : undefined, isSeq(oldNode) ? oldNode.items[index] : undefined)) };
    }

    if (isMap(node)) {
      const value: Record<string, Value> = Object.create(null);
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
          throw new Error('Resource map keys must be strings.');
        }

        const key = pair.key.value;
        value[key] = convert(pair.value, prior?.kind === 'map' ? prior.value[key] : undefined, isMap(oldNode) ? oldNode.get(key, true) : undefined);
      }

      return { kind: 'map', value };
    }

    if (node === null) {
      return { kind: 'null' };
    }

    throw new Error('Resource YAML aliases are not supported.');
  };

  return convert(document.contents, original, baseline.contents);
}
