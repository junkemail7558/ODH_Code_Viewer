// Rule Registry — add new rules here (kept sorted by ID)
const RULE_REGISTRY = [
  {
    id: "3701-31-01",
    title: "Definitions",
    chapter: "3701-31",
    chapterTitle: "Public Swimming Pools or Spas",
    getData: () => RULE_3701_31_01
  },
  {
    id: "3701-31-02",
    title: "Responsibilities of the director of health",
    chapter: "3701-31",
    chapterTitle: "Public Swimming Pools or Spas",
    getData: () => RULE_3701_31_02
  },
  {
    id: "3701-31-03",
    title: "Licensure of public swimming pools and spas",
    chapter: "3701-31",
    chapterTitle: "Public Swimming Pools or Spas",
    getData: () => RULE_3701_31_03
  },
  {
    id: "3701-31-04",
    title: "Responsibilities of the licensee",
    chapter: "3701-31",
    chapterTitle: "Public Swimming Pools or Spas",
    getData: () => RULE_3701_31_04
  },
  {
    id: "3701-31-05",
    title: "Submission of plans prior to licensure",
    chapter: "3701-31",
    chapterTitle: "Public Swimming Pools or Spas",
    getData: () => RULE_3701_31_05
  },
  {
    id: "3749.02",
    type: "statute",
    title: "Adoption of rules for public swimming pools, spas, and special use pools",
    getData: () => ORC_3749_02
  },
  {
    id: "3749.03",
    type: "statute",
    title: "Approval of plans by director of health",
    getData: () => ORC_3749_03
  },
  {
    id: "3749.01",
    type: "statute",
    title: "Swimming pool definitions",
    getData: () => ORC_3749_01
  },
  {
    id: "3749.04",
    type: "statute",
    title: "Annual application for license to operate or maintain pool or spa",
    getData: () => ORC_3749_04
  },
  {
    id: "3749.05",
    type: "statute",
    title: "Disciplinary actions by licensor of district",
    getData: () => ORC_3749_05
  },
  {
    id: "3749.06",
    type: "statute",
    title: "Inspection of public swimming pool, public spa, or special use pool",
    getData: () => ORC_3749_06
  },
  {
    id: "3749.07",
    type: "statute",
    title: "Annual survey of health districts for compliance",
    getData: () => ORC_3749_07
  },
  {
    id: "3749.08",
    type: "statute",
    title: "Pressure of pool and spa water features",
    getData: () => ORC_3749_08
  },
  {
    id: "3749.09",
    type: "statute",
    title: "Prohibitions - injunctive relief",
    getData: () => ORC_3749_09
  },
  {
    id: "3749.99",
    type: "statute",
    title: "Penalty",
    getData: () => ORC_3749_99
  }
];
