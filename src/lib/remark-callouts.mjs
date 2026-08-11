// Remark plugin: semantic callouts.
// Markdown authors write a blockquote whose first text begins with a
// marker like [!GOTCHA]. This plugin strips the marker, converts the
// blockquote to an aside, and attaches classes plus a data-label that
// the CSS renders as the callout heading. Unknown markers pass through
// untouched as ordinary blockquotes.
const TYPES = {
  'HOW-IT-WORKS': { key: 'how', label: 'How it works' },
  'GOTCHA': { key: 'gotcha', label: 'Gotcha' },
  'ON-THE-WIRE': { key: 'wire', label: 'On the wire' },
  'FROM-THE-FIELD': { key: 'field', label: 'From the field' },
  'LAB': { key: 'lab', label: 'Lab' },
};

const MARKER = /^\[!([A-Z-]+)\]\s*/;

function transform(node) {
  if (!node || !Array.isArray(node.children)) return;
  for (const child of node.children) transform(child);
  if (node.type !== 'blockquote') return;
  const para = node.children.find((c) => c.type === 'paragraph');
  if (!para || !Array.isArray(para.children)) return;
  const first = para.children[0];
  if (!first || first.type !== 'text') return;
  const match = first.value.match(MARKER);
  if (!match) return;
  const type = TYPES[match[1]];
  if (!type) return;
  first.value = first.value.replace(MARKER, '');
  node.data = node.data || {};
  node.data.hName = 'aside';
  node.data.hProperties = {
    className: ['callout', `callout-${type.key}`],
    'data-label': type.label,
  };
}

export default function remarkCallouts() {
  return (tree) => transform(tree);
}
