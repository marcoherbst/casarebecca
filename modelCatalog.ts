export type ProtectedModelEntry = {
  description: string;
  fragmentFileName: string;
  id: string;
  projectName: string;
  size: string;
  sourceFileName: string;
};

export const PROTECTED_MODEL_CATALOG = [
  {
    description: "",
    fragmentFileName: "casa_rebecca.frag",
    id: "casa_rebecca",
    projectName: "Casa Rebecca",
    size: "12.4 MB",
    sourceFileName: "Casa Rebecca.ifc",
  },
  {
    description: "",
    fragmentFileName: "siobhan_house.frag",
    id: "siobhan_house",
    projectName: "siobhan house",
    size: "4.1 MB",
    sourceFileName: "siobhan house.ifc",
  },
  {
    description: "",
    fragmentFileName: "kilpoole.frag",
    id: "kilpoole",
    projectName: "Kilpoole",
    size: "0.1 MB",
    sourceFileName: "Kilpoole.ifc",
  },
  {
    description: "",
    fragmentFileName: "evercam_wicklow.frag",
    id: "evercam_wicklow",
    projectName: "Evercam Wicklow",
    size: "19 KB",
    sourceFileName: "Evercam Wicklow.ifc",
  },
  {
    description: "",
    fragmentFileName: "evercam_berlin.frag",
    id: "evercam_berlin",
    projectName: "Evercam Berlin",
    size: "47 KB",
    sourceFileName: "Evercam Berlin.ifc",
  },
  {
    description: "",
    fragmentFileName: "evercam_usa.frag",
    id: "evercam_usa",
    projectName: "Evercam USA",
    size: "0.3 MB",
    sourceFileName: "Evercam USA.ifc",
  },
  {
    description: "",
    fragmentFileName: "aughrim.frag",
    id: "aughrim",
    projectName: "Aughrim",
    size: "47 KB",
    sourceFileName: "Aughrim.ifc",
  },
  {
    description: "",
    fragmentFileName: "polo_wicklow_1.frag",
    id: "polo_wicklow_1",
    projectName: "Polo Wicklow (1)",
    size: "0.2 MB",
    sourceFileName: "Polo Wicklow (1).ifc",
  },
  {
    description: "",
    fragmentFileName: "herbst_house_detache.frag",
    id: "herbst_house_detache",
    projectName: "Herbst House_détaché",
    size: "0.2 MB",
    sourceFileName: "Herbst House_détaché.ifc",
  },
  {
    description: "",
    fragmentFileName: "pink_house_1_1.frag",
    id: "pink_house_1_1",
    projectName: "Pink house (1) (1)",
    size: "0.4 MB",
    sourceFileName: "Pink house (1) (1).ifc",
  },
] as const satisfies readonly ProtectedModelEntry[];

export function getProtectedModel(id: string) {
  return PROTECTED_MODEL_CATALOG.find((model) => model.id === id);
}
