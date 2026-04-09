// Rule Registry — add new rules here
const RULE_REGISTRY = [
  {
    id: "3701-31-04",
    title: "Responsibilities of the licensee",
    chapter: "3701-31",
    chapterTitle: "Public Swimming Pools or Spas",
    getData: () => RULE_3701_31_04
  },
  {
    id: "3701-31-01",
    title: "Rule 3701-31-01 | Definitions",
    getData: () => RULE_3701_31_01
  },
  {
    id: "3701-31-02",
    title: "Rule 3701-31-02 | Responsibilities of the director of health",
    getData: () => RULE_3701_31_02
  },
  {
    id: "3701-31-03",
    title: "",
    getData: () => RULE_3701_31_03
  },
  {
    id: "3701-31-05",
    title: "Rule 3701-31-05 | Submission of plans prior to licensure",
    getData: () => RULE_3701_31_05
  }
];
