/* WRI Respond — observation type catalog for the "Add to COP" tab.
 * Mirrors the Recon app's Config_ReconTypes sheet (seed list) with its icons
 * extracted to static PNGs (assets/obs/). Static by design: the gateway API
 * has no read on the Recon app's config sheet, and these codes change rarely.
 * Keep in sync with the Recon app when a type is added there.
 * Attached to `self` so sw.js could importScripts() it if ever needed. */
self.OBS_CATEGORIES = ['Observations', 'Response Actions', 'Safety'];

/* icon = filename in assets/obs/ (some codes share art, matching the Recon
 * app's alias map: icp/scat/tactical_team). */
self.OBS_TYPES = [
  // Observations
  { category: 'Observations', code: 'oil_spotted',       label: 'Oil Spotted',        icon: 'oil_spotted' },
  { category: 'Observations', code: 'injured_wildlife',  label: 'Injured Wildlife',   icon: 'injured_wildlife' },
  { category: 'Observations', code: 'river_hazard',      label: 'River Hazard',       icon: 'river_hazard', has_subtype: true },
  { category: 'Observations', code: 'fish_kill',         label: 'Fish Kill',          icon: 'fish_kill' },
  { category: 'Observations', code: 'other_observation', label: 'Other Observation',  icon: 'other_observation' },
  // Response Actions
  { category: 'Response Actions', code: 'safety_briefing',      label: 'Safety Briefing',       icon: 'safety_briefing' },
  { category: 'Response Actions', code: 'current_boom_site',    label: 'Current Boom Site',     icon: 'current_boom_site' },
  { category: 'Response Actions', code: 'planned_boom_site',    label: 'Planned Boom Site',     icon: 'planned_boom_site' },
  { category: 'Response Actions', code: 'recovery_complete',    label: 'Recovery Complete',     icon: 'recovery_complete' },
  { category: 'Response Actions', code: 'drone_flight',         label: 'Drone Flight',          icon: 'drone_flight' },
  { category: 'Response Actions', code: 'response_action',      label: 'Response Action',       icon: 'response_action' },
  { category: 'Response Actions', code: 'icp',                  label: 'Incident Command Post', icon: 'incident_command_post' },
  { category: 'Response Actions', code: 'staging_area',         label: 'Staging Area',          icon: 'staging_area' },
  { category: 'Response Actions', code: 'planned_staging_area', label: 'Planned Staging Area',  icon: 'planned_staging_area' },
  { category: 'Response Actions', code: 'tactical_team',        label: 'Tactical/Ops Team',     icon: 'tactical_operational_team' },
  { category: 'Response Actions', code: 'landing_zone',         label: 'Landing Zone',          icon: 'landing_zone' },
  { category: 'Response Actions', code: 'boat_ramp',            label: 'Boat Ramp',             icon: 'boat_ramp' },
  { category: 'Response Actions', code: 'hospital',             label: 'Hospital',              icon: 'hospital' },
  { category: 'Response Actions', code: 'road_closure',         label: 'Road Closure',          icon: 'road_closure' },
  { category: 'Response Actions', code: 'aid_station',          label: 'Aid Station',           icon: 'aid_station' },
  { category: 'Response Actions', code: 'decon',                label: 'Decon',                 icon: 'decon' },
  { category: 'Response Actions', code: 'scat',                 label: 'SCAT Point',            icon: 'scat_point' },
  { category: 'Response Actions', code: 'other_action',         label: 'Other Action',          icon: 'other_action' },
  // Safety — accepted and stored, but the public COP map's recon view
  // excludes the Safety category, so these reach the ICP, not the shared map.
  { category: 'Safety', code: 'near_miss',    label: 'Near Miss',    icon: 'near_miss' },
  { category: 'Safety', code: 'injury',       label: 'Injury',       icon: 'injury' },
  { category: 'Safety', code: 'other_safety', label: 'Other Safety', icon: 'other_safety' }
];

self.OBS_SUBTYPES = {
  river_hazard: [
    { code: 'strainer',     label: 'Strainer' },
    { code: 'rock',         label: 'Rock' },
    { code: 'shallows',     label: 'Shallows' },
    { code: 'rapid',        label: 'Rapid' },
    { code: 'other_hazard', label: 'Other Hazard' }
  ]
};
