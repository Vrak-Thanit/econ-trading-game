export const ITEMS = [
  { id: "paper", label: "Paper" },
  { id: "scissors", label: "Scissors" },
  { id: "protractor", label: "Protractor" },
  { id: "straightRuler", label: "Straight ruler" },
  { id: "compass", label: "Compass" },
  { id: "pencil", label: "Pencil" },
  { id: "triangleRuler", label: "Triangle ruler" },
  { id: "equilateralRuler", label: "Equilateral ruler" },
  { id: "sticker", label: "Sticker" },
  { id: "labor", label: "Labor" },
] as const;

export type ItemId = (typeof ITEMS)[number]["id"];
export type AssetId = ItemId | "cash";

export const ASSETS: { id: AssetId; label: string }[] = [
  { id: "cash", label: "Cash ($)" },
  ...ITEMS,
];

export function assetLabel(id: AssetId): string {
  const found = ASSETS.find((a) => a.id === id);
  return found ? found.label : id;
}
