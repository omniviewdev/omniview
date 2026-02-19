import React from "react";

// material-ui
import Button from "@mui/joy/Button";
import FormControl from "@mui/joy/FormControl";
import FormHelperText from "@mui/joy/FormHelperText";
import Grid from "@mui/joy/Grid";
import IconButton from "@mui/joy/IconButton";
import Input from "@mui/joy/Input";
// import List from "@mui/joy/List";
// import ListItem from "@mui/joy/ListItem";
// import ListItemButton from "@mui/joy/ListItemButton";
import Textarea from "@mui/joy/Textarea";
import Typography from "@mui/joy/Typography";
import Stack from "@mui/joy/Stack";

// types
import { Secret } from "kubernetes-types/core/v1";
// import { DaemonSet, Deployment, StatefulSet } from "kubernetes-types/apps/v1";
// import {
//   ResourceSearchResult,
// } from "../../../types/resource";

// project-imports
import ObjectMetaSection from "../../shared/ObjectMetaSection";
import { isMultiLine } from "../../../utils/text";
import { useSnackbar } from '@omniviewdev/runtime';
// import { deplomentUsesSecret } from "../../../utils/filters/appsv1/deployment";
// import { statefulSetUsesSecret } from "../../../utils/filters/appsv1/statefulset";
// import { daemonSetUsesSecret } from "../../../utils/filters/appsv1/daemonset";
// import Card from "../../shared/Card";

// icons
import {
  LuClipboardCheck,
  LuClipboardCopy,
  LuEye,
  LuEyeOff,
  LuKey,
  LuPlus,
  LuRotate3D,
  LuSave,
  LuX,
  LuCircleX,
} from "react-icons/lu";
import { DrawerContext } from "@omniviewdev/runtime";

const decodeEntries = (data?: Record<string, string>) => {
  if (!data) {
    return {};
  }
  // return a new data map with the decoded values
  return Object.entries(data).reduce(
    (acc, [key, value]) => {
      acc[key] = atob(value);
      return acc;
    },
    {} as Record<string, string>,
  );
};

interface Props {
  ctx: DrawerContext<Secret>;
}

/**
 * Renders a sidebar for a Secret resource
 */
export const SecretSidebar: React.FC<Props> = ({
  ctx,
}) => {
  if (!ctx.data) {
    return null;
  }

  const secret = ctx.data;

  const { showSnackbar } = useSnackbar();
  const [shown, setShown] = React.useState<Record<string, boolean>>({});
  const [copied, setCopied] = React.useState<string | undefined>(undefined);

  const originalValues = decodeEntries(secret?.data);
  const [values, setValues] =
    React.useState<Record<string, string>>(originalValues);
  const [newValues, setNewValues] = React.useState<
    Array<Record<string, string>>
  >([]);
  const [edited, setEdited] = React.useState<boolean>(false);
  const [newErrors, setNewErrors] = React.useState<Record<number, string>>({});

  // look for other resources using this secret
  // const [deployments, statefulsets, daemonsets] = useSearch({
  //   searches: [
  //     {
  //       key: "apps::v1::Deployment",
  //       namespaces: [],
  //       postFilter: (deployment: Deployment) =>
  //         deplomentUsesSecret(deployment, data as Secret),
  //     },
  //     {
  //       key: "apps::v1::StatefulSet",
  //       namespaces: [],
  //       postFilter: (statefulset: StatefulSet) =>
  //         statefulSetUsesSecret(statefulset, data as Secret),
  //     },
  //     {
  //       key: "apps::v1::DaemonSet",
  //       namespaces: [],
  //       postFilter: (daemonset: DaemonSet) =>
  //         daemonSetUsesSecret(daemonset, data as Secret),
  //     },
  //   ],
  // });

  // assert this is in fact a secret
  if (secret?.kind !== "Secret") {
    throw new Error("Invalid resource kind");
  }

  const checkNewForErrors = (index: number, key: string, value: string) => {
    if (values[key]) {
      setNewErrors((prev) => ({ ...prev, [index]: "Key already exists" }));
    } else if (key === "") {
      setNewErrors((prev) => ({ ...prev, [index]: "Key cannot be empty" }));
    } else if (key.match(/\s/)) {
      setNewErrors((prev) => ({
        ...prev,
        [index]: "Key cannot contain whitespace",
      }));
    } else if (value === "" && newValues[index]?.value !== "") {
      setNewErrors((prev) => ({ ...prev, [index]: "Value cannot be empty" }));
    } else if (newValues.some((val, idx) => val.key === key && idx !== index)) {
      setNewErrors((prev) => ({ ...prev, [index]: "Key already exists" }));
    } else {
      setNewErrors((prev) => {
        // delete the error if it exists
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
    }
  };

  /**
   * Handle changing a secret value.
   * NOTE: The value should come in as an already decoded string to prevent extra overhead
   * at form edit time.
   */
  const handleChange = (key: string, value: string) => {
    // check first if the value is visible
    if (!shown[key]) {
      return;
    }

    setEdited(true);
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddKey = () => {
    setEdited(true);
    setNewValues([...newValues, { key: "", value: "" }]);
  };

  const handleEditNewKey = (index: number, key: string, value: string) => {
    setEdited(true);
    checkNewForErrors(index, key, value);
    setNewValues((newVals) =>
      newVals.map((val, i) => (i === index ? { key, value } : val)),
    );
  };

  const handleRemoveKey = (index: number) => {
    setEdited(true);
    setNewValues((newVals) => newVals.filter((_, i) => i !== index));
    setNewErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[index];
      return newErrors;
    });
  };

  const handleClear = () => {
    setEdited(false);
    setValues(originalValues);
    setNewValues([]);
  };

  const handleSubmit = () => {
    const draft = secret as Secret;

    // we decoded our values upfront to save on rerender performance, so re-encode them here
    draft.data = Object.entries(values).reduce(
      (acc, [key, value]) => {
        acc[key] = btoa(value);
        return acc;
      },
      {} as Record<string, string>,
    );

    // add our new values
    newValues.forEach((entry) => {
      if (draft.data === undefined) {
        draft.data = {};
      }

      draft.data[entry.key] = btoa(entry.value);
    });

    try {
      setEdited(false);
      setNewValues([]);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleShowSecret = (key: string) => {
    setShown((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCopyToClipboard = (key: string, value: string) => {
    navigator.clipboard.writeText(atob(value));
    setCopied(key);
    showSnackbar({
      message: "Copied value to clipboard",
      status: 'success'
    })
  };

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={secret.metadata} />
      <Stack
        direction="row"
        pt={1}
        pl={1}
        spacing={1}
        justifyContent={"space-between"}
        alignItems={"center"}
      >
        <Typography startDecorator={<LuKey />} level="title-md">
          Secrets
        </Typography>
        <Button
          variant="outlined"
          startDecorator={<LuPlus />}
          size="sm"
          onClick={handleAddKey}
        >
          Add Entry
        </Button>
      </Stack>
      <Stack direction="column" spacing={0.25} px={0.25}>
        {values !== undefined && (
          <Grid container spacing={0.5}>
            {Object.entries(values).map(([key, value]) => (
              <React.Fragment key={key}>
                <Grid
                  xs={4}
                  key={key}
                  sx={{ alignItems: "center", alignContent: "center" }}
                >
                  <Typography level="body-sm">{key}</Typography>
                </Grid>
                <Grid xs={8}>
                  {shown[key] && isMultiLine(value) ? (
                    <Textarea
                      startDecorator={
                        <Stack
                          direction="row"
                          spacing={0}
                          justifyContent={"space-between"}
                        >
                          <IconButton
                            disabled={value === ""}
                            onClick={() => handleCopyToClipboard(key, value)}
                            size="sm"
                          >
                            {copied === key ? (
                              <LuClipboardCheck />
                            ) : (
                              <LuClipboardCopy />
                            )}
                          </IconButton>
                          <IconButton
                            onClick={() => toggleShowSecret(key)}
                            size="sm"
                          >
                            {shown[key] ? <LuEyeOff /> : <LuEye />}
                          </IconButton>
                        </Stack>
                      }
                      size="sm"
                      value={shown[key] ? values[key] : "********"}
                    />
                  ) : (
                    <Input
                      endDecorator={
                        <Stack direction="row" spacing={0}>
                          <IconButton
                            disabled={value === ""}
                            onClick={() => handleCopyToClipboard(key, value)}
                            size="sm"
                          >
                            {copied === key ? (
                              <LuClipboardCheck />
                            ) : (
                              <LuClipboardCopy />
                            )}
                          </IconButton>
                          <IconButton
                            onClick={() => toggleShowSecret(key)}
                            size="sm"
                          >
                            {shown[key] ? <LuEyeOff /> : <LuEye />}
                          </IconButton>
                        </Stack>
                      }
                      sx={{
                        "--Input-focused": +!(
                          values[key] === originalValues[key]
                        ),
                      }}
                      size="sm"
                      onChange={(e) => handleChange(key, e.target.value)}
                      value={shown[key] ? values[key] : "********"}
                    />
                  )}
                </Grid>
              </React.Fragment>
            ))}
          </Grid>
        )}
        {newValues.map((entry, index) => (
          <Grid container spacing={0.5} key={index}>
            <Grid xs={4}>
              <FormControl error={!!newErrors[index]}>
                <Input
                  size="sm"
                  onChange={(e) =>
                    handleEditNewKey(index, e.target.value, entry.value)
                  }
                  endDecorator={
                    <IconButton
                      sx={{
                        "--IconButton-size": "24px",
                      }}
                      onClick={() => handleRemoveKey(index)}
                      size="sm"
                      variant="soft"
                    >
                      <LuX size={16} />
                    </IconButton>
                  }
                  value={newValues[index].key}
                />
                {!!newErrors[index] && (
                  <FormHelperText>{newErrors[index]}</FormHelperText>
                )}
              </FormControl>
            </Grid>
            <Grid xs={8}>
              <Input
                size="sm"
                onChange={(e) =>
                  handleEditNewKey(index, entry.key, e.target.value)
                }
                value={newValues[index].value}
              />
            </Grid>
          </Grid>
        ))}
      </Stack>
      {edited && (
        <Stack direction="row" justifyContent={"space-between"} spacing={1}>
          <Stack direction="row" spacing={1}>
            <Button
              variant="soft"
              startDecorator={<LuSave />}
              size="sm"
              onClick={handleSubmit}
              disabled={Object.keys(newErrors).length > 0}
            >
              Save
            </Button>
            <Button
              variant="soft"
              startDecorator={<LuRotate3D />}
              size="sm"
              onClick={() => console.log("trigerred reload save")}
              disabled={Object.keys(newErrors).length > 0}
            >
              Save & Reload Resources
            </Button>
          </Stack>
          <Button
            variant="outlined"
            color="neutral"
            startDecorator={<LuCircleX />}
            size="sm"
            onClick={handleClear}
          >
            Clear
          </Button>
        </Stack>
      )}
      {/* {(!!deployments?.data?.length || */}
      {/*   !!statefulsets?.data?.length || */}
      {/*   !!daemonsets?.data?.length) && ( */}
      {/*     <Typography level="title-md" pl={1}> */}
      {/*       Used By */}
      {/*     </Typography> */}
      {/*   )} */}
      {/* <UsedDeploymentsCard deployments={deployments} /> */}
      {/* <UsedStatefulSetsCard statefulsets={statefulsets} /> */}
      {/* <UsedDaemonSetsCard daemonsets={daemonsets} /> */}
    </Stack>
  );
};
//
// const UsedDeploymentsCard: React.FC<{ deployments: ResourceSearchResult }> = ({
//   deployments,
// }) => {
//   if (deployments?.isLoading || !deployments?.data || deployments?.isError) {
//     return <React.Fragment />;
//   }
//
//   const result = deployments.data as Array<Deployment>;
//   if (result.length === 0) {
//     return <React.Fragment />;
//   }
//
//   return (
//     <Card title="Deployments" icon={<LuBox />} titleDecorator={result.length}>
//       <List
//         size="sm"
//         sx={{
//           borderRadius: "sm",
//         }}
//       >
//         {result.map((deployment) => (
//           <ListItem>
//             <ListItemButton>{deployment.metadata?.name}</ListItemButton>
//           </ListItem>
//         ))}
//       </List>
//     </Card>
//   );
// };
//
// const UsedStatefulSetsCard: React.FC<{
//   statefulsets: ResourceSearchResult;
// }> = ({ statefulsets }) => {
//   if (statefulsets?.isLoading || !statefulsets?.data || statefulsets?.isError) {
//     return <React.Fragment />;
//   }
//   const result = statefulsets.data as Array<StatefulSet>;
//   if (result.length === 0) {
//     return <React.Fragment />;
//   }
//   return (
//     <Card title="StatefulSets" icon={<LuBox />} titleDecorator={result.length}>
//       <List
//         size="sm"
//         sx={{
//           borderRadius: "sm",
//         }}
//       >
//         {result.map((statefulset) => (
//           <ListItem>
//             <ListItemButton>{statefulset.metadata?.name}</ListItemButton>
//           </ListItem>
//         ))}
//       </List>
//     </Card>
//   );
// };
//
// const UsedDaemonSetsCard: React.FC<{ daemonsets: ResourceSearchResult }> = ({
//   daemonsets,
// }) => {
//   if (daemonsets?.isLoading || !daemonsets?.data || daemonsets?.isError) {
//     return <React.Fragment />;
//   }
//   const result = daemonsets.data as Array<DaemonSet>;
//   if (result.length === 0) {
//     return <React.Fragment />;
//   }
//   return (
//     <Card title="DaemonSets" icon={<LuBox />} titleDecorator={result.length}>
//       <List
//         size="sm"
//         sx={{
//           borderRadius: "sm",
//         }}
//       >
//         {result.map((daemonset) => (
//           <ListItem sx={{ borderRadius: "sm" }}>
//             <ListItemButton sx={{ borderRadius: "sm" }}>
//               {daemonset.metadata?.name}
//             </ListItemButton>
//           </ListItem>
//         ))}
//       </List>
//     </Card>
//   );
// };

SecretSidebar.displayName = "SecretSidebar";
export default SecretSidebar;
