import { ArrowRightLeft, Clock } from 'lucide-react';
import ChargesPage from './ChargesPage';
import HoursPage   from './HoursPage';

// The one place a feature is declared. Adding another means adding an entry here and a
// page component — the home page, the header and the routing all follow from this.
//
// `orgs` lists the RoseRocket orgs a tool acts on and drives the badge shown beside its
// name. Use ['CET'], ['CEL'], or both for a tool that covers the pair.
//
// Set `status: 'soon'` to show a feature on the home page before it is built; those cards
// are shown but not clickable.
export const FEATURES = [
  {
    id: 'charges',
    name: 'Fuel Charge Automation',
    blurb: 'Deduct fuel card and toll charges from driver settlement bills',
    detail: 'Upload BVD, EZ Pass and BlueWater exports for a pay period, review the charges per driver, then post them to RoseRocket.',
    icon: ArrowRightLeft,
    accent: 'blue',
    orgs: ['CET'],
    component: ChargesPage,
  },
  {
    id: 'hours',
    name: 'Local Driver Hourly',
    blurb: 'Fill in manifest hours from Motive electronic logs',
    detail: "Reads each local driver's day from Motive and writes the hours onto the matching manifest, replacing entry from paper run sheets.",
    icon: Clock,
    accent: 'emerald',
    orgs: ['CET'],
    component: HoursPage,
  },
];

export const findFeature = id => FEATURES.find(f => f.id === id) ?? null;
