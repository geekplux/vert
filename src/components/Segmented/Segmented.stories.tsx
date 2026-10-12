import type { Story } from '@ladle/react';
import { useState } from 'react';
import { Segmented } from './Segmented';

export default { title: 'Components / Segmented' };

type UnitSystem = 'metric' | 'imperial';

const units = [
  { value: 'metric', label: 'km' },
  { value: 'imperial', label: 'mi' },
] as const;

const frame = { padding: 'var(--space-10)' };

export const Units: Story = () => {
  const [value, setValue] = useState<UnitSystem>('metric');
  return (
    <div style={frame}>
      <Segmented label="Units" options={units} value={value} onChange={setValue} />
    </div>
  );
};

export const ImperialSelected: Story = () => {
  const [value, setValue] = useState<UnitSystem>('imperial');
  return (
    <div style={frame}>
      <Segmented label="Units" options={units} value={value} onChange={setValue} />
    </div>
  );
};
ImperialSelected.storyName = 'Imperial selected';

type View = 'oblique' | 'top' | 'flat';

const views = [
  { value: 'oblique', label: 'Oblique' },
  { value: 'top', label: 'Top' },
  { value: 'flat', label: 'Flat' },
] as const;

export const ThreeOptions: Story = () => {
  const [value, setValue] = useState<View>('oblique');
  return (
    <div style={frame}>
      <Segmented label="Camera view" options={views} value={value} onChange={setValue} />
    </div>
  );
};
ThreeOptions.storyName = 'Three options';
