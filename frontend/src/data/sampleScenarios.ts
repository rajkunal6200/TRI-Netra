import { SampleScenario } from '@shared/types';

export const SAMPLE_SCENARIOS: SampleScenario[] = [
  {
    id: 'scen-unauth-intruder',
    title: 'Restricted Vault Breach (Unauthorized Intruder)',
    category: 'UNAUTHORIZED',
    description: 'An unidentified person wearing a dark tactical jacket attempting unauthorized door bypass in the Server Vault.',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=900&auto=format&fit=crop&crop=faces&q=80',
    zone: 'Server Vault',
    expectedOutcome: 'Immediate Critical Threat Alert, unauthorized individual flagged, alarm triggered.',
  },
  {
    id: 'scen-auth-executive',
    title: 'Executive Corridor (Chief Security Officer Chen)',
    category: 'AUTHORIZED',
    description: 'CSO Sarah Chen entering the secure executive wing during regular hours.',
    imageUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=900&auto=format&fit=crop&crop=faces&q=80',
    zone: 'Executive Suite',
    expectedOutcome: 'Status: Authorized. Clearance Level 4 verified. Zero alert.',
  },
  {
    id: 'scen-unauth-visitor',
    title: 'Loading Bay Loitering (Unidentified Subject)',
    category: 'UNAUTHORIZED',
    description: 'Unknown individual without security clearance badge standing near high-voltage distribution racks.',
    imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=900&auto=format&fit=crop&crop=faces&q=80',
    zone: 'Loading Bay',
    expectedOutcome: 'High Threat Alert. Identity mismatch with all registered staff. Security dispatch suggested.',
  },
  {
    id: 'scen-auth-engineer',
    title: 'Server Vault Maintenance (David Okafor)',
    category: 'AUTHORIZED',
    description: 'Lead Security Architect David Okafor conducting scheduled telemetry review at terminal.',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900&auto=format&fit=crop&crop=faces&q=80',
    zone: 'Server Vault',
    expectedOutcome: 'Status: Authorized. Clearance Level 3 verified. Access granted.',
  },
  {
    id: 'scen-mixed-group',
    title: 'Main Lobby Entry (Multiple Individuals)',
    category: 'MIXED',
    description: 'Group approaching the optical turnstiles containing authorized staff accompanied by an unverified guest.',
    imageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=900&auto=format&fit=crop&crop=faces&q=80',
    zone: 'Main Entrance',
    expectedOutcome: 'Multi-face identification. Separate bounding boxes for verified vs unverified subjects.',
  },
];
