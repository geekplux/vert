import type { Story } from '@ladle/react';
import { useState } from 'react';
import type { Units } from '../../lib/format';
import { AppHeader } from './AppHeader';
import { PosterNav } from './PosterNav';
import { UploadNav } from './UploadNav';
import { ViewNav } from './ViewNav';

// Each story sets its width so Ladle renders it in an iframe of that size and media queries apply.
export default { title: 'Page / AppHeader' };

const log = (what: string) => () => {
  console.log(what);
};

const Upload = () => (
  <AppHeader state="upload">
    <UploadNav onAbout={log('about')} />
  </AppHeader>
);

const View = () => {
  const [units, setUnits] = useState<Units>('metric');
  return (
    <AppHeader state="view">
      <ViewNav
        units={units}
        onUnitsChange={setUnits}
        onNewFile={log('new file')}
        onMakePoster={log('make a poster')}
      />
    </AppHeader>
  );
};

const Poster = () => (
  <AppHeader state="poster" routeName="Coosa Backcountry Trail">
    <PosterNav onBack={log('back')} />
  </AppHeader>
);

export const Upload1440: Story = () => <Upload />;
Upload1440.storyName = 'Upload 1440';
Upload1440.meta = { width: 1440 };

export const Upload390: Story = () => <Upload />;
Upload390.storyName = 'Upload 390';
Upload390.meta = { width: 390 };

export const View1440: Story = () => <View />;
View1440.storyName = 'View 1440';
View1440.meta = { width: 1440 };

export const View390: Story = () => <View />;
View390.storyName = 'View 390';
View390.meta = { width: 390 };

export const Poster1440: Story = () => <Poster />;
Poster1440.storyName = 'Poster 1440';
Poster1440.meta = { width: 1440 };

export const Poster390: Story = () => <Poster />;
Poster390.storyName = 'Poster 390';
Poster390.meta = { width: 390 };
