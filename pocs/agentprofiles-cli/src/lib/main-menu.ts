import { select, isCancel, cancel } from '@clack/prompts';

type MenuAction = 'list' | 'add' | 'set' | 'unset' | 'edit' | 'remove';

const menuOptions: Array<{ value: MenuAction; label: string; hint: string }> = [
  { value: 'list', label: 'List profiles', hint: 'Show all profiles' },
  { value: 'add', label: 'Add profile', hint: 'Create a new profile' },
  { value: 'set', label: 'Set profile', hint: 'Activate a profile for this directory' },
  { value: 'unset', label: 'Unset profile', hint: 'Deactivate a profile for this directory' },
  { value: 'edit', label: 'Edit profile', hint: 'Open a profile in your editor' },
  { value: 'remove', label: 'Remove profile', hint: 'Delete a profile' },
];

export async function showMainMenu(): Promise<void> {
  const response = await select({
    message: 'What would you like to do?',
    options: menuOptions,
  });

  if (isCancel(response)) {
    cancel('Goodbye!');
    process.exit(0);
  }

  const action = response as MenuAction;

  switch (action) {
    case 'list': {
      const { listCommand } = await import('../commands/list.js');
      await listCommand();
      break;
    }
    case 'add': {
      const { addCommand } = await import('../commands/add.js');
      await addCommand();
      break;
    }
    case 'set': {
      const { setCommand } = await import('../commands/set.js');
      await setCommand();
      break;
    }
    case 'unset': {
      const { unsetCommand } = await import('../commands/unset.js');
      await unsetCommand();
      break;
    }
    case 'edit': {
      const { editCommand } = await import('../commands/edit.js');
      await editCommand();
      break;
    }
    case 'remove': {
      const { removeCommand } = await import('../commands/remove.js');
      await removeCommand();
      break;
    }
  }
}
