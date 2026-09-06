import { useState } from 'react';
import { Clock, Link2 } from 'lucide-react';
import { SubTabs } from './ui';
import HoursTab       from './HoursTab';
import DriverLinksTab from './DriverLinksTab';

const TABS = [
  { id: 'hours', label: 'Manifest Hours', icon: Clock },
  { id: 'links', label: 'Driver Links',   icon: Link2 },
];

export default function HoursPage() {
  const [tab, setTab] = useState('hours');
  return (
    <>
      <SubTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'hours' && <HoursTab />}
      {tab === 'links' && <DriverLinksTab />}
    </>
  );
}
