import { useState } from 'react';
import { ArrowRightLeft, Users, Radio } from 'lucide-react';
import { SubTabs } from './ui';
import ProcessTab      from './ProcessTab';
import DriversTab      from './DriversTab';
import TranspondersTab from './TranspondersTab';

const TABS = [
  { id: 'process',      label: 'Process Charges', icon: ArrowRightLeft },
  { id: 'drivers',      label: 'Drivers',         icon: Users },
  { id: 'transponders', label: 'Transponders',    icon: Radio },
];

export default function ChargesPage() {
  const [tab, setTab] = useState('process');
  return (
    <>
      <SubTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'process'      && <ProcessTab />}
      {tab === 'drivers'      && <DriversTab />}
      {tab === 'transponders' && <TranspondersTab />}
    </>
  );
}
