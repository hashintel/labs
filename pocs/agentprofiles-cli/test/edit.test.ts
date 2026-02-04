import { describe, it, expect } from 'vitest';
import { parseEditorValue } from '../src/commands/edit.js';

describe('parseEditorValue', () => {
  it('handles simple editor without arguments', () => {
    expect(parseEditorValue('vim')).toEqual({ command: 'vim', args: [] });
  });

  it('handles editor with a single argument', () => {
    expect(parseEditorValue('code --wait')).toEqual({
      command: 'code',
      args: ['--wait'],
    });
  });

  it('handles quoted editor path with arguments', () => {
    const value =
      '"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --wait';
    const parsed = parseEditorValue(value);

    expect(parsed.command).toBe(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    );
    expect(parsed.args).toEqual(['--wait']);
  });

  it('trims surrounding whitespace', () => {
    expect(parseEditorValue('  nano  ')).toEqual({ command: 'nano', args: [] });
  });

  it('returns empty command for blank input', () => {
    expect(parseEditorValue('   ')).toEqual({ command: '', args: [] });
  });
});
