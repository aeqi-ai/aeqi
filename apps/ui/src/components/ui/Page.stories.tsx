import type { Meta, StoryObj } from "@storybook/react";
import {
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  PageToolbar,
} from "./Page";
import { Badge, StatusBadge } from "./Badge";
import { Button } from "./Button";
import { Input } from "./Input";
import { Table, type TableColumn } from "./Table";

const meta: Meta<typeof Page> = {
  title: "Primitives/Layout/Page",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Canonical internal page layout primitives: Page, PageHeader, PageBody, PageSection, PageToolbar, MetricGrid, and MetricCard. The set standardizes page measure, header actions, toolbar zones, section rhythm, and metric summaries without page-level CSS.",
      },
    },
  },
  argTypes: {
    width: { control: "select", options: ["default", "wide", "full"] },
    padding: { control: "select", options: ["none", "md", "lg"] },
    gap: { control: "select", options: ["0", "1", "2", "3", "4", "5", "6", "8"] },
  },
};

export default meta;
type Story = StoryObj<typeof Page>;

interface QuestRow {
  id: string;
  title: string;
  owner: string;
  status: "in_progress" | "pending" | "blocked" | "done";
  priority: "High" | "Medium" | "Low";
  updated: string;
}

const questRows: QuestRow[] = [
  {
    id: "q-101",
    title: "Harden runtime deploy workflow",
    owner: "ops-agent",
    status: "in_progress",
    priority: "High",
    updated: "12 min",
  },
  {
    id: "q-102",
    title: "Review pricing page events",
    owner: "growth-agent",
    status: "pending",
    priority: "Medium",
    updated: "38 min",
  },
  {
    id: "q-103",
    title: "Resolve invite permission edge case",
    owner: "governance-agent",
    status: "blocked",
    priority: "High",
    updated: "1 h",
  },
  {
    id: "q-104",
    title: "Publish weekly operator digest",
    owner: "chief-of-staff",
    status: "done",
    priority: "Low",
    updated: "2 h",
  },
];

const questColumns: Array<TableColumn<QuestRow>> = [
  {
    key: "title",
    header: "Quest",
    cell: (row) => row.title,
    width: "42%",
    sortable: true,
    sortAccessor: (row) => row.title,
  },
  {
    key: "owner",
    header: "Owner",
    cell: (row) => row.owner,
    width: "22%",
    sortable: true,
    sortAccessor: (row) => row.owner,
  },
  {
    key: "status",
    header: "Status",
    cell: (row) => <StatusBadge status={row.status} size="sm" />,
    width: "18%",
    sortable: true,
    sortAccessor: (row) => row.status,
  },
  {
    key: "updated",
    header: "Updated",
    cell: (row) => row.updated,
    width: "18%",
    align: "end",
    sortable: true,
    sortAccessor: (row) => row.updated,
  },
];

export const InternalAppPage: Story = {
  name: "Internal app page",
  render: () => (
    <Page width="wide">
      <PageHeader
        title="Operations"
        description="Runtime work across active company agents, grouped for scan-first review."
        meta={<Badge variant="accent">Company Scope</Badge>}
        actions={
          <>
            <Button variant="secondary" size="sm">
              Export
            </Button>
            <Button variant="primary" size="sm">
              New quest
            </Button>
          </>
        }
      />

      <PageBody>
        <PageToolbar
          aria-label="Operations controls"
          grow
          actions={
            <Button variant="primary" size="sm">
              Assign
            </Button>
          }
        >
          <Input aria-label="Search quests" placeholder="Search quests" size="sm" />
        </PageToolbar>

        <MetricGrid columns={4}>
          <MetricCard label="Active quests" value="18" detail="Across six agents" />
          <MetricCard label="Blocked" value="2" detail="Needs operator review" />
          <MetricCard label="Done today" value="7" trend="+3" detail="Since 09:00" />
          <MetricCard label="Runtime cost" value="$42" detail="Current day" />
        </MetricGrid>

        <PageSection
          title="Quest queue"
          description="Sorted by the work most likely to need operator attention."
          actions={
            <Button variant="secondary" size="sm">
              View all
            </Button>
          }
        >
          <Table
            columns={questColumns}
            data={questRows}
            rowKey={(row) => row.id}
            defaultSort={{ key: "updated", dir: "asc" }}
            ariaLabel="Operations quest queue"
          />
        </PageSection>
      </PageBody>
    </Page>
  ),
};

export const SectionOnly: Story = {
  name: "Section only",
  render: () => (
    <Page width="default">
      <PageSection title="Integrations" description="Compact section rhythm for settings pages.">
        <MetricGrid columns={3}>
          <MetricCard label="Connected" value="5" />
          <MetricCard label="Needs review" value="1" />
          <MetricCard label="Disabled" value="0" />
        </MetricGrid>
      </PageSection>
    </Page>
  ),
};
