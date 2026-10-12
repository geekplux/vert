import type { Story } from '@ladle/react';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS } from '../state';
import type { PageState } from '../state';

// The whole page in the View state with the sample run loaded. Each story sets its width so Ladle
// renders it in an iframe of that size and media queries apply.
export default { title: 'Page / View' };

const VIEW: PageState = { screen: { name: 'view', runId: SAMPLE_RUN.id }, prefs: INITIAL_PREFS };
const IMPERIAL: PageState = { ...VIEW, prefs: { ...INITIAL_PREFS, units: 'imperial' } };

export const View1440: Story = () => <Page initialRun={SAMPLE_RUN} initialState={VIEW} />;
View1440.storyName = 'View 1440';
View1440.meta = { width: 1440 };

export const View900: Story = () => <Page initialRun={SAMPLE_RUN} initialState={VIEW} />;
View900.storyName = 'View 900';
View900.meta = { width: 900 };

export const View390: Story = () => <Page initialRun={SAMPLE_RUN} initialState={VIEW} />;
View390.storyName = 'View 390';
View390.meta = { width: 390 };

export const Imperial: Story = () => <Page initialRun={SAMPLE_RUN} initialState={IMPERIAL} />;
Imperial.meta = { width: 1440 };
