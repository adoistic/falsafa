// Greek ⇄ Roman (and a few other) theonym identity groups, so the figure layer
// merges e.g. Venus≡Aphrodite, Jupiter≡Zeus, Hercules≡Heracles across works.
// Heuristic and auditable: each group lists equivalent surface forms, matched as
// whole dash-tokens (so "Mars" never bleeds into "Marsyas"). Greek form is canonical.

export interface TheonymGroup {
  canonical: string;
  names: string[];
}

export const THEONYM_GROUPS: TheonymGroup[] = [
  { canonical: "Zeus", names: ["Zeus", "Jupiter", "Jove"] },
  { canonical: "Hera", names: ["Hera", "Juno"] },
  { canonical: "Poseidon", names: ["Poseidon", "Neptune"] },
  { canonical: "Aphrodite", names: ["Aphrodite", "Venus", "Cytherea", "Cypris"] },
  { canonical: "Ares", names: ["Ares", "Mars"] },
  { canonical: "Hermes", names: ["Hermes", "Mercury"] },
  { canonical: "Artemis", names: ["Artemis", "Diana"] },
  { canonical: "Athena", names: ["Athena", "Athene", "Minerva", "Pallas"] },
  { canonical: "Hephaestus", names: ["Hephaestus", "Hephaistos", "Vulcan"] },
  { canonical: "Hestia", names: ["Hestia", "Vesta"] },
  { canonical: "Demeter", names: ["Demeter", "Ceres"] },
  { canonical: "Dionysus", names: ["Dionysus", "Dionysos", "Bacchus", "Liber"] },
  { canonical: "Eros", names: ["Eros", "Cupid", "Amor"] },
  { canonical: "Cronus", names: ["Cronus", "Cronos", "Kronos", "Saturn"] },
  { canonical: "Rhea", names: ["Rhea"] },
  { canonical: "Hades", names: ["Hades", "Pluto", "Orcus", "Aidoneus"] },
  { canonical: "Persephone", names: ["Persephone", "Proserpina", "Proserpine", "Kore"] },
  { canonical: "Heracles", names: ["Heracles", "Herakles", "Hercules", "Alcides"] },
  { canonical: "Odysseus", names: ["Odysseus", "Ulysses"] },
  { canonical: "Gaia", names: ["Gaia", "Gaea", "Terra"] },
  { canonical: "Uranus", names: ["Uranus", "Ouranos", "Caelus"] },
  { canonical: "Helios", names: ["Helios", "Sol"] },
  { canonical: "Selene", names: ["Selene", "Luna"] },
  { canonical: "Eos", names: ["Eos", "Aurora"] },
  { canonical: "Leto", names: ["Leto", "Latona"] },
  { canonical: "Hecate", names: ["Hecate", "Hekate"] },
  { canonical: "Apollo", names: ["Apollo", "Phoebus"] },
  { canonical: "Cybele", names: ["Cybele", "Magna Mater"] },
];
