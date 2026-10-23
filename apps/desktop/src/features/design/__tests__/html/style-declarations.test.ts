import { describe, expect, it } from 'vitest';
import { setDeclaration } from '../../html/style-declarations';

describe('setDeclaration', () => {
  it('replaces the matched declaration and preserves the rest byte-for-byte', () => {
    expect(setDeclaration('color: red; margin : 0', 'color', 'blue')).toBe(
      'color: blue; margin : 0'
    );
    // odd spacing of the untouched declaration survives
    expect(setDeclaration('color: red; margin : 0', 'background-color', 'white')).toBe(
      'color: red; margin : 0; background-color: white'
    );
  });

  it('lets the last same-name declaration win and keeps earlier ones', () => {
    // The matched segment is replaced whole (`${name}: ${value}`), so the
    // matched segment's own leading space is not preserved — earlier
    // declarations and separators are.
    expect(setDeclaration('color: red; margin: 0; color: blue', 'color', 'green')).toBe(
      'color: red; margin: 0;color: green'
    );
  });

  it('preserves the original property-name spelling when replacing', () => {
    expect(setDeclaration('COLOR: red', 'color', 'blue')).toBe('COLOR: blue');
    expect(setDeclaration('Color:red', 'color', 'blue')).toBe('Color: blue');
  });

  it('deletes a declaration and one adjacent semicolon', () => {
    // non-first segment: eats the `;` before it
    expect(setDeclaration('color: red; margin : 0', 'margin', null)).toBe('color: red');
    // first segment: eats the `;` after it
    expect(setDeclaration('color: red; margin : 0', 'color', null)).toBe(' margin : 0');
    expect(setDeclaration('color: red;', 'color', null)).toBe('');
  });

  it('appends with "; " and handles empty / trailing-semicolon values', () => {
    expect(setDeclaration('', 'color', 'red')).toBe('color: red');
    expect(setDeclaration('   ', 'color', 'red')).toBe('color: red');
    expect(setDeclaration('margin: 0', 'color', 'red')).toBe('margin: 0; color: red');
    expect(setDeclaration('margin: 0;', 'color', 'red')).toBe('margin: 0; color: red');
    expect(setDeclaration('  margin: 0  ', 'color', 'red')).toBe('margin: 0; color: red');
  });

  it('returns the input unchanged when clearing a missing declaration', () => {
    expect(setDeclaration('margin: 0', 'color', null)).toBe('margin: 0');
    expect(setDeclaration('', 'color', null)).toBe('');
  });

  it('ignores semicolons inside quoted url() values', () => {
    expect(setDeclaration('background: url("a;b.png"); color: red', 'color', 'blue')).toBe(
      'background: url("a;b.png");color: blue'
    );
    expect(setDeclaration("background: url('a;b.png')", 'background', 'green')).toBe(
      'background: green'
    );
    // unquoted url parentheses also protect the semicolon
    expect(setDeclaration('background: url(a;b.png); color: red', 'color', 'blue')).toBe(
      'background: url(a;b.png);color: blue'
    );
    expect(setDeclaration('background: url(a;b.png)', 'background', null)).toBe('');
  });

  it('keeps comments byte-for-byte; a segment whose name is prefixed by a comment does not match', () => {
    const value = '/* keep; me */ color: red; margin: 0';
    // The `;` inside the comment does not split, but the first-`:` name of the
    // first segment is "/* keep; me */ color" — no match → append (spec §2.2).
    expect(setDeclaration(value, 'color', 'blue')).toBe(
      '/* keep; me */ color: red; margin: 0; color: blue'
    );
    expect(setDeclaration(value, 'margin', null)).toBe('/* keep; me */ color: red');
  });
});
