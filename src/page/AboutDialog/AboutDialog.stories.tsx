import type { Story } from '@ladle/react';
import { Page } from '../Page';

// The Upload page with the About dialog open over it. Esc or Close closes it; About reopens it.
export default { title: 'Page / About dialog' };

export const Open1440: Story = () => <Page initialAboutOpen />;
Open1440.storyName = 'Open 1440';
Open1440.meta = { width: 1440 };

export const Open390: Story = () => <Page initialAboutOpen />;
Open390.storyName = 'Open 390';
Open390.meta = { width: 390 };
