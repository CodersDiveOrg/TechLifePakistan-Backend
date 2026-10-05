import {
  Box,
  Button,
  Flex,
  LinkButton,
  Modal,
  Typography,
} from "@strapi/design-system";
import { File as FileIcon } from "@strapi/icons";
import { Link } from "react-router-dom";
import { PRINT_OPTIONS, PrintMenu, usePrint } from "./pages/orders/print";

const ORDER = "api::order.order";

type EditViewProps = { model: string; documentId?: string };
type ListViewProps = { model: string; documents: { documentId: string }[] };

/** Content Manager → Order edit view: side panel with print / dispatch documents. */
export const OrderPrintPanel = ({ model, documentId }: EditViewProps) => {
  const printer = usePrint();
  if (model !== ORDER || !documentId) return null;
  return {
    title: "Dispatch & print",
    content: (
      <Flex direction="column" alignItems="stretch" gap={2} width="100%">
        <PrintMenu
          fullWidth
          loading={printer.busy}
          label="Print…"
          onPick={(type, size) => printer.printOrder(documentId, type, size)}
        />
        <LinkButton
          tag={Link}
          variant="tertiary"
          fullWidth
          to={`/orders-manager/${documentId}`}
        >
          Open in Orders
        </LinkButton>
      </Flex>
    ),
  };
};

function BulkPrintDialog({
  ids,
  onClose,
}: {
  ids: string[];
  onClose: () => void;
}) {
  const printer = usePrint();
  return (
    <Modal.Body>
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Typography textColor="neutral600">
          {ids.length} order{ids.length === 1 ? "" : "s"} selected — each prints
          on its own page.
        </Typography>
        {PRINT_OPTIONS.map((g) => (
          <Box key={g.group}>
            <Typography variant="sigma" textColor="neutral600">
              {g.group}
            </Typography>
            <Flex
              direction="column"
              alignItems="stretch"
              gap={2}
              paddingTop={2}
            >
              {g.items.map((o) => (
                <Button
                  key={`${o.type}-${o.size}`}
                  variant="tertiary"
                  startIcon={<FileIcon />}
                  loading={printer.busy}
                  onClick={async () => {
                    await printer.printOrders(ids, o.type, o.size);
                    onClose();
                  }}
                >
                  {o.label}
                </Button>
              ))}
            </Flex>
          </Box>
        ))}
      </Flex>
    </Modal.Body>
  );
}

/** Content Manager → Order list: "Print" bulk action for the selected orders. */
export const PrintOrdersBulkAction = ({ model, documents }: ListViewProps) => {
  if (model !== ORDER) return null;
  const ids = documents.map((d) => d.documentId);
  return {
    label: "Print",
    icon: <FileIcon />,
    variant: "secondary" as const,
    dialog: {
      type: "modal" as const,
      title: "Print orders",
      content: ({ onClose }: { onClose: () => void }) => (
        <BulkPrintDialog ids={ids} onClose={onClose} />
      ),
    },
  };
};
