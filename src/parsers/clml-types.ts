export type Document = {
  type: 'document';
  prelims: Prelims;
  body: (Division | Provision | Block)[];
  schedules: Schedule[];
};

/** Prelims */

export type Prelims = Block[];

/** Structure */

export type DivisionName = 'groupOfParts' | 'part' | 'chapter' | 'crossHeading' | 'subHeading';

export type Division = {
  type: 'division';
  name: DivisionName;
  number?: InlineContent;
  title: InlineContent;
  children: (Division | Provision)[];
};

type ProvisionBase = {
  type: 'provision';
  number: InlineContent;
  title?: InlineContent;
};

export type Provision =
  | ProvisionBase & { variant: 'leaf'; content: Block[] }
  | ProvisionBase & { variant: 'branch'; intro: Block[]; children: (SubProvision | Paragraph)[]; wrapUp: Block[] };

export type Schedule = {
  type: 'schedule';
  number: InlineContent;
  title?: InlineContent;
  subtitle?: InlineContent;
  reference?: InlineContent;
  body: (Division | Provision | Block)[];
};

type SubProvisionBase = {
  type: 'subProvision';
  number: InlineContent;
};

export type SubProvision =
  | SubProvisionBase & { variant: 'leaf'; content: Block[] }
  | SubProvisionBase & { variant: 'branch'; intro: Block[]; children: Paragraph[]; wrapUp: Block[] };

type ParagraphBase = {
  type: 'paragraph';
  number: InlineContent;
};

export type Paragraph =
  | ParagraphBase & { variant: 'leaf'; content: Block[] }
  | ParagraphBase & { variant: 'branch'; intro: Block[]; children: Paragraph[]; wrapUp: Block[] };

/** Blocks */

export type Block = Text | AppendText | Table | Figure | BlockAmendment | List | Footnote | NumberedParagraph;

export type Text = {
  type: 'text';
  content: InlineContent;
};

export type AppendText = {
  type: 'appendText';
  content: InlineContent;
};

export type Table = {
  type: 'table';
  rows: InlineContent[][];
};

export type Figure = {
  type: 'figure';
  number?: InlineContent;
  title?: InlineContent;
};

export type BlockAmendment = {
  type: 'blockAmendment';
  format?: 'single' | 'double' | 'none';
  children: (Division | Provision | Block)[];
};

export type List = {
  type: 'list';
  ordered: boolean;
  items: Block[][];
};

export type Footnote = {
  type: 'footnote';
  number: InlineContent;
  content: InlineContent;
};

export type NumberedParagraph = {
  type: 'numberedParagraph';
  number: InlineContent;
  children: Block[];
};

/** Inline content */

export type InlineContent = string; // will become rich inline nodes
