import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Card, CardHeader } from "./Card";
import { DetailField } from "./DetailField";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { Select } from "./Select";
import { StatusRow } from "./StatusRow";
import { Table, type TableColumn } from "./Table";
import { TagList } from "./TagList";
import styles from "./SystemCoherence.module.css";

const meta: Meta = {
  title: "Get Started/System Coherence",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A single review canvas for judging whether primitives read as one product system. Use this before shipping primitive changes.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

interface QuestRow {
  id: string;
  quest: string;
  owner: string;
  status: "working" | "blocked" | "done";
  updated: string;
}

const rows: QuestRow[] = [
  {
    id: "q-187",
    quest: "Normalize launch flow",
    owner: "founder-ops",
    status: "working",
    updated: "12m",
  },
  {
    id: "q-188",
    quest: "Review billing webhook",
    owner: "runtime",
    status: "blocked",
    updated: "47m",
  },
  {
    id: "q-189",
    quest: "Publish operator docs",
    owner: "docs",
    status: "done",
    updated: "2h",
  },
];

const columns: Array<TableColumn<QuestRow>> = [
  {
    key: "quest",
    header: "Quest",
    width: "38%",
    cell: (row) => <span className={styles.tableCellStrong}>{row.quest}</span>,
  },
  {
    key: "owner",
    header: "Owner",
    width: "22%",
    cell: (row) => <span className={styles.tableCellMuted}>{row.owner}</span>,
  },
  {
    key: "status",
    header: "Status",
    width: "20%",
    cell: (row) => (
      <Badge
        variant={
          row.status === "blocked" ? "warning" : row.status === "done" ? "success" : "accent"
        }
        size="sm"
        dot
      >
        {row.status === "done" ? "Done" : row.status === "blocked" ? "Blocked" : "Working"}
      </Badge>
    ),
  },
  {
    key: "updated",
    header: "Updated",
    width: "20%",
    align: "end",
    cell: (row) => <span className={styles.tableCellMuted}>{row.updated}</span>,
  },
];

export const ReviewCanvas: Story = {
  name: "Review canvas",
  render: () => (
    <main className={styles.frame}>
      <div className={styles.shell}>
        <aside className={styles.rail}>
          <div className={styles.brand}>
            <span className={styles.wordmark}>aeqi</span>
            <Badge variant="accent" size="sm">
              MVP
            </Badge>
          </div>
          <div className={styles.railGroup}>
            <span className={styles.railLabel}>Workspace</span>
            <span className={`${styles.railItem} ${styles.railItemActive}`}>
              Launch{" "}
              <Badge variant="success" size="sm" dot>
                Ready
              </Badge>
            </span>
            <span className={styles.railItem}>Quests</span>
            <span className={styles.railItem}>Agents</span>
            <span className={styles.railItem}>Settings</span>
          </div>
          <StatusRow dot="active" label="Runtime online" status="healthy" />
          <StatusRow dot="warning" label="Billing review" status="pending" />
        </aside>

        <section className={styles.content}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarSearch}>
              <Input size="sm" placeholder="Search launch work" aria-label="Search launch work" />
            </div>
            <Select
              size="sm"
              value="all"
              onChange={() => {}}
              aria-label="Filter owner"
              options={[
                { value: "all", label: "All owners" },
                { value: "runtime", label: "Runtime" },
                { value: "docs", label: "Docs" },
              ]}
            />
            <IconButton aria-label="Refresh launch work" variant="bordered" size="sm">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M13 3v4H9" />
                <path d="M3 13V9h4" />
                <path d="M12.1 6A4.5 4.5 0 0 0 4.4 4.4L3 5.8" />
                <path d="M3.9 10A4.5 4.5 0 0 0 11.6 11.6L13 10.2" />
              </svg>
            </IconButton>
            <Button variant="primary" size="sm">
              New Quest
            </Button>
          </div>

          <div className={styles.mainGrid}>
            <div className={styles.stack}>
              <Card padding="md">
                <div className={styles.cardHeader}>
                  <div className={styles.titleGroup}>
                    <h2 className={styles.title}>Launch cockpit</h2>
                    <p className={styles.copy}>
                      A dense operating surface using the same field, badge, table, card, and action
                      language.
                    </p>
                  </div>
                  <Badge variant="info" dot>
                    In Review
                  </Badge>
                </div>

                <div className={styles.panelBody}>
                  <div className={styles.metrics}>
                    <div className={styles.metric}>
                      <span className={styles.sectionLabel}>Open</span>
                      <div className={styles.metricValue}>18</div>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.sectionLabel}>Blocked</span>
                      <div className={styles.metricValue}>2</div>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.sectionLabel}>Today</span>
                      <div className={styles.metricValue}>7</div>
                    </div>
                  </div>

                  <Banner kind="info">
                    This canvas should feel like the app, not a component showroom.
                  </Banner>

                  <Table
                    columns={columns}
                    data={rows}
                    rowKey={(row) => row.id}
                    density="compact"
                    ariaLabel="Launch quest review"
                  />
                </div>
              </Card>

              <Card padding="md" variant="surface">
                <CardHeader title="Create a follow-up" />
                <div className={styles.panelBody}>
                  <div className={styles.formGrid}>
                    <Input label="Quest" placeholder="Review activation email" />
                    <Select
                      value="launch"
                      onChange={() => {}}
                      aria-label="Quest scope"
                      options={[
                        { value: "launch", label: "Launch" },
                        { value: "runtime", label: "Runtime" },
                        { value: "docs", label: "Docs" },
                      ]}
                    />
                  </div>
                  <div className={styles.actions}>
                    <Button variant="secondary">Cancel</Button>
                    <Button variant="primary">Create</Button>
                  </div>
                </div>
              </Card>
            </div>

            <div className={styles.stack}>
              <Card padding="md">
                <CardHeader
                  title="System fit"
                  actions={<Badge variant="success">Coherent</Badge>}
                />
                <div className={styles.panelBody}>
                  <DetailField label="Surface ladder">{"paper -> card -> elevated"}</DetailField>
                  <DetailField label="Control rhythm">28 / 32 / 40 px</DetailField>
                  <DetailField label="Radius rule">8 px cards, 12 px modals</DetailField>
                  <TagList items={["graphite", "quiet", "dense", "tokenized"]} />
                  <div className={styles.reviewNote}>
                    If a primitive looks louder here than it does alone, its token balance is wrong.
                  </div>
                </div>
              </Card>

              <Card padding="md">
                <EmptyState
                  title="No visual exceptions"
                  description="New UI should compose from this surface before inventing another class."
                  action={<Button variant="secondary">Open Inventory</Button>}
                />
              </Card>
            </div>
          </div>
        </section>
      </div>
    </main>
  ),
};
