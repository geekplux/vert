import type { Story } from '@ladle/react';
import { useState } from 'react';
import { Checkbox } from './Checkbox';

export default { title: 'Components / Checkbox' };

export const Checked: Story = () => {
  const [checked, setChecked] = useState(true);
  return <Checkbox label="Distance" checked={checked} onChange={setChecked} />;
};

export const Unchecked: Story = () => {
  const [checked, setChecked] = useState(false);
  return <Checkbox label="High point" checked={checked} onChange={setChecked} />;
};

export const Disabled: Story = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <Checkbox label="Time" checked disabled onChange={() => undefined} />
    <Checkbox label="High point" checked={false} disabled onChange={() => undefined} />
  </div>
);

const stats = [
  ['distance', 'Distance'],
  ['vert', 'Vert'],
  ['time', 'Time'],
  ['highPoint', 'High point'],
] as const;

type StatKey = (typeof stats)[number][0];

export const StatsGroup: Story = () => {
  const [shown, setShown] = useState<Record<StatKey, boolean>>({
    distance: true,
    vert: true,
    time: true,
    highPoint: false,
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {stats.map(([key, label]) => (
        <Checkbox
          key={key}
          name="stats"
          value={key}
          label={label}
          checked={shown[key]}
          onChange={(checked) => {
            setShown((previous) => ({ ...previous, [key]: checked }));
          }}
        />
      ))}
    </div>
  );
};
StatsGroup.storyName = 'Stats group';
