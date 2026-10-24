import { describe, expect, it } from 'vitest';
import { buildElementTree, childElementPath, type ElementTreeNode } from '../element-tree';

function findNode(nodes: ElementTreeNode[], path: number[]): ElementTreeNode | null {
  for (const node of nodes) {
    if (node.path.join(',') === path.join(',')) return node;
    const found = findNode(node.children, path);
    if (found) return found;
  }
  return null;
}

function countNodes(nodes: ElementTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

describe('buildElementTree', () => {
  it('builds paths, tag names, ids, classes and text previews from the body', () => {
    const tree = buildElementTree(
      `<html><body>
        <main id="root" class="layout wide extra fourth">
          <h1>
      Hello tree
          </h1>
          <p class="intro">This preview text is longer than forty characters in total.</p>
          <!-- a comment that must be skipped -->
          <div></div>
        </main>
      </body></html>`
    );
    expect(tree).toHaveLength(1);
    const main = tree[0]!;
    expect(main).toMatchObject({
      path: [0],
      tagName: 'main',
      id: 'root',
      classes: ['layout', 'wide', 'extra'],
      capability: 'editable',
    });
    expect(main.reason).toBeUndefined();
    expect(main.truncated).toBeUndefined();
    expect(main.children.map(child => child.tagName)).toEqual(['h1', 'p', 'div']);
    expect(findNode(tree, [0, 0])).toMatchObject({
      path: [0, 0],
      tagName: 'h1',
      id: null,
      classes: [],
      textPreview: 'Hello tree',
      capability: 'editable',
    });
    expect(findNode(tree, [0, 1])?.textPreview).toBe(
      'This preview text is longer than forty c'
    );
    expect(findNode(tree, [0, 1])?.textPreview).toHaveLength(40);
    expect(findNode(tree, [0, 2])?.textPreview).toBe('');
  });

  it('marks parse5-implied elements without a source location as implicit', () => {
    const tree = buildElementTree(
      '<body><table><tr><td>cell</td></tr></table></body>'
    );
    const table = findNode(tree, [0]);
    expect(table?.tagName).toBe('table');
    expect(table?.capability).toBe('editable');
    const tbody = table?.children.find(child => child.tagName === 'tbody');
    expect(tbody).toBeDefined();
    expect(tbody?.capability).toBe('implicit');
    expect(tbody?.reason).toBe('No explicit tag in the source');
    // Implicit nodes still expand their subtree for navigation.
    expect(tbody?.children.map(child => child.tagName)).toEqual(['tr']);
  });

  it('marks the whole svg subtree, including nested elements, as svg-subtree', () => {
    const tree = buildElementTree(
      '<body><svg viewBox="0 0 10 10"><g><text>hi</text></g></svg><p>after</p></body>'
    );
    const svg = findNode(tree, [0]);
    expect(svg?.capability).toBe('svg-subtree');
    expect(svg?.reason).toBe('SVG content supports only text, style, and structure changes');
    expect(findNode(tree, [0, 0])?.capability).toBe('svg-subtree');
    expect(findNode(tree, [0, 0, 0])?.capability).toBe('svg-subtree');
    expect(findNode(tree, [1])?.capability).toBe('editable');
  });

  it('stops expanding at depth 64 and reports deep capability with empty children', () => {
    const depth = 70;
    const source = `<body>${'<div>'.repeat(depth)}leaf${'</div>'.repeat(depth)}</body>`;
    const tree = buildElementTree(source);
    const shallow = findNode(tree, Array(63).fill(0));
    expect(shallow?.capability).toBe('editable');
    const deep = findNode(tree, Array(64).fill(0));
    expect(deep?.capability).toBe('deep');
    expect(deep?.reason).toBe('Nesting exceeds the preview bridge limit');
    expect(deep?.children).toEqual([]);
    // Nothing beyond the bridge limit appears in the tree.
    expect(findNode(tree, Array(65).fill(0))).toBeNull();
  });

  it('flags truncated on the node whose children hit the visited-node cap', () => {
    const siblings = 10500;
    const source = `<body><section>${'<i></i>'.repeat(siblings)}</section></body>`;
    const tree = buildElementTree(source);
    const section = tree[0];
    expect(section?.truncated).toBe(true);
    // section itself + up to 10000 visited descendants.
    expect(section?.children.length).toBe(9999);
    expect(countNodes(tree)).toBe(10000);
  });

  it('returns an empty list when the source has no body content', () => {
    expect(buildElementTree('')).toEqual([]);
    expect(buildElementTree('<html><head><title>t</title></head><body></body></html>')).toEqual([]);
  });
});

describe('childElementPath', () => {
  const source = '<body><div><p>only child</p></div><div></div></body>';

  it('returns the first child path when the element has children', () => {
    expect(childElementPath(source, [])).toEqual([0]);
    expect(childElementPath(source, [0])).toEqual([0, 0]);
  });

  it('returns null when the element has no children or the path leaves the tree', () => {
    expect(childElementPath(source, [1])).toBeNull();
    expect(childElementPath(source, [5])).toBeNull();
    expect(childElementPath(source, [0, 3])).toBeNull();
    expect(childElementPath(source, [-1])).toBeNull();
  });
});
