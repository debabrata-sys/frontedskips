import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
  Grid,
  IconButton,
  Link,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { DataGrid, GridToolbar } from "@mui/x-data-grid";
import { Add, Delete, Search, Refresh } from "@mui/icons-material";
import MenuPageShell from "./MenuPageShell";
import ep1 from "../api/ep1";
import global1 from "./global1";

const emptyFilter = { field: "", value: "" };

const isStudentRole = (role) => {
  return /^student$/i.test(String(role || "").trim());
};

const titleCase = (value = "") => String(value)
  .replace(/^customFields\./, "")
  .replace(/([A-Z])/g, " $1")
  .replace(/_/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/^./, (char) => char.toUpperCase());

const fieldDisplayName = (field = {}) => (
  field.displayname
  || field.displayName
  || field.label
  || field.fieldlabel
  || field.fieldLabel
  || field.name
  || titleCase(field.field || "")
);

const cleanValue = (value) => {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default function EmployeeMasterDataPage() {
  const [fields, setFields] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [selectedRole, setSelectedRole] = useState("Faculty");
  const [filters, setFilters] = useState([{ ...emptyFilter }]);
  const [filterOptions, setFilterOptions] = useState({});
  const [loadingOptions, setLoadingOptions] = useState({});
  const [rows, setRows] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Keep a ref to filters for async cascading calls
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const roleOptions = useMemo(() => {
    const rolesFromLayout = (layouts || [])
      .map((row) => row.role)
      .filter((r) => r && !isStudentRole(r));
    return Array.from(new Set(["Faculty", "Admin", "All Non-Students", ...rolesFromLayout])).sort();
  }, [layouts]);

  const layoutFields = useMemo(() => (
    Array.from((layouts || [])
      .filter((item) => String(item.visible || "Yes") !== "No")
      .filter((item) => {
        if (isStudentRole(item.role)) return false;
        if (!selectedRole || selectedRole === "All Non-Students" || selectedRole === "All") return true;
        return item.role === selectedRole;
      })
      .sort((a, b) => Number(a.sectionorder || 0) - Number(b.sectionorder || 0)
        || String(a.section || "").localeCompare(String(b.section || ""))
        || Number(a.order || 0) - Number(b.order || 0)
        || String(a.label || a.field || "").localeCompare(String(b.label || b.field || "")))
      .reduce((map, item) => {
        if (item.field && !map.has(item.field)) map.set(item.field, item);
        return map;
      }, new Map()).values())
  ), [layouts, selectedRole]);

  const ensureFilterFields = (items = []) => {
    const required = [
      ["role", "Role"],
      ["name", "Name"],
      ["email", "Email"],
      ["user", "User Email"],
      ["department", "Department"],
      ["designation", "Designation"],
      ["institution", "Institution"],
      ["employeeid", "Employee ID"],
      ["staffid", "Staff ID"],
      ["gender", "Gender"],
      ["category", "Category"],
      ["joiningdate", "Joining Date"],
      ["bloodgroup", "Blood Group"],
      ["phone", "Phone"],
      ["status", "Status"]
    ];
    const map = new Map(items.map((item) => [item.field, item]));
    required.forEach(([field, label]) => {
      if (!map.has(field)) map.set(field, { field, label });
    });
    return Array.from(map.values());
  };

  useEffect(() => {
    loadMeta();
  }, []);

  const loadMeta = async () => {
    try {
      const [metaRes, layoutRes] = await Promise.all([
        ep1.get("/api/v2/user-data/meta", { params: { colid: global1.colid } }),
        ep1.get("/api/v2/user-profile-display-layouts", { params: { colid: global1.colid } })
      ]);
      const allFields = ensureFilterFields(
        (metaRes.data?.filterFields || []).filter((field) => !String(field.field).includes("$"))
      );
      setFields(allFields);
      setLayouts(layoutRes.data || []);
    } catch (err) {
      setError(err.response?.data?.msg || "Unable to load employee metadata");
    }
  };

  // Helper to fetch cascading options for a given field considering previous active filters
  const fetchCascadingOptions = async (fieldName, currentFilters = filtersRef.current, role = selectedRole) => {
    if (!fieldName) return;
    setLoadingOptions((prev) => ({ ...prev, [fieldName]: true }));
    try {
      // Build active filters excluding the target field itself
      const activeFilters = currentFilters
        .filter((f) => f.field && f.field !== fieldName && String(f.value || "").trim() !== "")
        .map((f) => ({ field: f.field, value: f.value }));

      if (role && role !== "All Non-Students" && role !== "All") {
        activeFilters.push({ field: "role", value: role });
      }

      let res;
      try {
        // Primary: GET endpoint with query parameters (standard across backend)
        res = await ep1.get("/api/v2/user-data/options", {
          params: {
            colid: global1.colid,
            field: fieldName,
            filters: JSON.stringify(activeFilters),
            excludeStudent: true
          }
        });
      } catch (getErr) {
        // Fallback: POST endpoint
        res = await ep1.post("/api/v2/user-data/options", {
          colid: global1.colid,
          field: fieldName,
          filters: activeFilters,
          excludeStudent: true
        });
      }

      let options = (res?.data || []).map((item) => String(item)).filter((x) => x && x !== "-");

      // Secondary fallback: if server returned empty but rows are loaded, derive distinct values from rows
      if ((!options || options.length === 0) && rows.length > 0) {
        const fromRows = Array.from(new Set(
          rows.map((r) => {
            const rawVal = r[fieldName] ?? (
              String(fieldName).startsWith("customFields.")
                ? r.customFields?.[String(fieldName).replace("customFields.", "")]
                : undefined
            );
            return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "" ? String(rawVal).trim() : null;
          }).filter(Boolean)
        )).sort();
        if (fromRows.length) {
          options = fromRows;
        }
      }

      setFilterOptions((prev) => ({ ...prev, [fieldName]: options }));
    } catch {
      // Client-side fallback from loaded rows if network failed
      const fromRows = Array.from(new Set(
        rows.map((r) => {
          const rawVal = r[fieldName] ?? (
            String(fieldName).startsWith("customFields.")
              ? r.customFields?.[String(fieldName).replace("customFields.", "")]
              : undefined
          );
          return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "" ? String(rawVal).trim() : null;
        }).filter(Boolean)
      )).sort();
      setFilterOptions((prev) => ({ ...prev, [fieldName]: fromRows }));
    } finally {
      setLoadingOptions((prev) => ({ ...prev, [fieldName]: false }));
    }
  };

  const updateFilter = async (index, key, value) => {
    const next = filters.map((item, itemIndex) => {
      if (itemIndex === index) {
        return {
          ...item,
          [key]: value,
          ...(key === "field" ? { value: "" } : {})
        };
      }
      return item;
    });
    setFilters(next);

    if (key === "field" && value) {
      // Load options for the freshly chosen field cascading from other filters
      await fetchCascadingOptions(value, next);
    } else if (key === "value") {
      // When a filter value changes, re-fetch cascading options for subsequent/other filter fields
      next.forEach((f, i) => {
        if (i !== index && f.field) {
          fetchCascadingOptions(f.field, next);
        }
      });
    }
  };

  const handleRoleChange = (newRole) => {
    const roleVal = newRole || "Faculty";
    setSelectedRole(roleVal);
    setRows([]);
    setSelectedRows([]);
    // Refresh cascading options for all selected filter fields with the new role
    filters.forEach((f) => {
      if (f.field) {
        fetchCascadingOptions(f.field, filters, roleVal);
      }
    });
  };

  const searchRows = async () => {
    setLoading(true);
    setError("");
    try {
      const activeFilters = filters
        .filter((filter) => filter.field && String(filter.value || "").trim() !== "")
        .map((filter) => ({ field: filter.field, value: filter.value }));

      if (selectedRole && selectedRole !== "All Non-Students" && selectedRole !== "All") {
        activeFilters.push({ field: "role", value: selectedRole });
      }

      const res = await ep1.post("/api/v2/user-data/search", {
        colid: global1.colid,
        filters: activeFilters,
        excludeStudent: true,
        limit: 20000
      });

      // Filter out students explicitly on client side as an extra safeguard
      const nonStudents = (res.data || []).filter((row) => !isStudentRole(row.role));

      const flattened = nonStudents.map((row) => {
        const custom = row.customFields || {};
        const next = { ...row };
        layoutFields.forEach((field) => {
          next[field.field] = String(field.field || "").startsWith("customFields.")
            ? custom[String(field.field).replace("customFields.", "")] ?? ""
            : row[field.field] ?? "";
        });
        return next;
      });

      setRows(flattened);
      setSelectedRows([]);
      // Refresh options for filter fields from the newly loaded rows if options are currently empty
      filters.forEach((f) => {
        if (f.field && (!filterOptions[f.field] || !filterOptions[f.field].length)) {
          const fromRows = Array.from(new Set(
            flattened.map((r) => {
              const rawVal = r[f.field] ?? (
                String(f.field).startsWith("customFields.")
                  ? r.customFields?.[String(f.field).replace("customFields.", "")]
                  : undefined
              );
              return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "" ? String(rawVal).trim() : null;
            }).filter(Boolean)
          )).sort();
          if (fromRows.length) {
            setFilterOptions((prev) => ({ ...prev, [f.field]: fromRows }));
          }
        }
      });
    } catch (err) {
      setError(err.response?.data?.msg || "Unable to load employees");
    } finally {
      setLoading(false);
    }
  };

  const columns = useMemo(() => {
    // If no display layout fields found, provide sensible default employee columns
    const effectiveFields = layoutFields.length ? layoutFields : [
      { field: "name", label: "Name" },
      { field: "email", label: "Email" },
      { field: "role", label: "Role" },
      { field: "department", label: "Department" },
      { field: "designation", label: "Designation" },
      { field: "phone", label: "Phone" },
      { field: "institution", label: "Institution" },
      { field: "status", label: "Status" }
    ];

    return effectiveFields.map((field) => ({
      field: field.field,
      headerName: field.label || fieldDisplayName(field),
      minWidth: 180,
      flex: 1,
      renderCell: ({ value }) => (
        <Typography variant="body2" sx={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>
          {cleanValue(value)}
        </Typography>
      )
    }));
  }, [layoutFields]);

  return (
    <MenuPageShell title="Employee Master Data">
      <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: "#f6f7fb", minHeight: "100vh" }}>
        <Paper elevation={0} sx={{ p: 2, mb: 2, border: "1px solid #e5e7eb" }}>
          <Breadcrumbs sx={{ mb: 0.5 }}>
            <Link underline="hover" color="inherit" href="/dashdashfacnew">Dashboard</Link>
            <Typography color="text.primary">HR & User Management</Typography>
          </Breadcrumbs>
          <Typography variant="h5" fontWeight={900}>Employee Master Data</Typography>
          <Typography color="text.secondary">
            Master repository for all employee and staff records. Excludes student records with cascading dynamic filters.
          </Typography>
        </Paper>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

        <Paper sx={{ p: 2, mb: 2 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            alignItems={{ xs: "stretch", md: "center" }}
            justifyContent="space-between"
            spacing={1}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>Cascading Dynamic Filters</Typography>
              <Typography variant="body2" color="text.secondary">
                {rows.length} matching employees loaded. {selectedRows.length} selected.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button
                variant="outlined"
                disabled={!rows.length}
                onClick={() => setSelectedRows(rows.map((row) => row._id))}
              >
                Select all loaded
              </Button>
              <Button
                startIcon={<Add />}
                variant="outlined"
                onClick={() => setFilters((prev) => [...prev, { ...emptyFilter }])}
              >
                Add Filter
              </Button>
              <Button
                startIcon={<Refresh />}
                variant="outlined"
                onClick={() => {
                  setFilters([{ ...emptyFilter }]);
                  setFilterOptions({});
                  setRows([]);
                  setSelectedRows([]);
                }}
              >
                Reset Filters
              </Button>
            </Stack>
          </Stack>

          <Grid container spacing={1.5}>
            <Grid item xs={12} md={4}>
              <Autocomplete
                options={roleOptions}
                value={selectedRole}
                onChange={(_, value) => handleRoleChange(value)}
                renderInput={(params) => <TextField {...params} size="small" label="Employee Role" />}
              />
            </Grid>
            <Grid item xs={12} md={8}>
              <Alert severity={layoutFields.length ? "info" : "info"} sx={{ py: 0.5 }}>
                {layoutFields.length
                  ? `${layoutFields.length} configured display layout fields for ${selectedRole}.`
                  : `Showing default employee columns for ${selectedRole}.`}
              </Alert>
            </Grid>

            {filters.map((filter, index) => {
              const getFieldOptions = () => {
                if (filterOptions[filter.field] && filterOptions[filter.field].length > 0) {
                  return filterOptions[filter.field];
                }
                if (selectedField?.options && selectedField.options.length > 0) {
                  return selectedField.options.map(String);
                }
                if (rows.length > 0 && filter.field) {
                  const key = String(filter.field).startsWith("customFields.")
                    ? String(filter.field).replace("customFields.", "")
                    : null;
                  const fromRows = Array.from(new Set(
                    rows.map((r) => {
                      const val = key ? (r.customFields?.[key] ?? r[filter.field]) : r[filter.field];
                      return val !== undefined && val !== null && String(val).trim() !== "" ? String(val).trim() : null;
                    }).filter(Boolean)
                  )).sort();
                  if (fromRows.length > 0) return fromRows;
                }
                return [];
              };
              const options = getFieldOptions();
              const isLoadingOpts = Boolean(loadingOptions[filter.field]);

              return (
                <React.Fragment key={index}>
                  <Grid item xs={12} md={4}>
                    <Autocomplete
                      options={fields}
                      getOptionLabel={(option) => fieldDisplayName(option)}
                      value={fields.find((f) => f.field === filter.field) || null}
                      onChange={(_, value) => updateFilter(index, "field", value?.field || "")}
                      renderInput={(params) => <TextField {...params} size="small" label={`Field ${index + 1}`} />}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Autocomplete
                      freeSolo
                      options={options}
                      value={filter.value || ""}
                      loading={isLoadingOpts}
                      onOpen={() => {
                        if (filter.field && (!filterOptions[filter.field] || !filterOptions[filter.field].length)) {
                          fetchCascadingOptions(filter.field, filters);
                        }
                      }}
                      onChange={(_, newValue) => updateFilter(index, "value", typeof newValue === "string" ? newValue : (newValue?.value || newValue || ""))}
                      onInputChange={(_, value) => updateFilter(index, "value", value)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="small"
                          label={isLoadingOpts ? "Loading cascading values..." : "Value"}
                          helperText={filter.field ? `${options.length} cascading option(s) available` : ""}
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} md={2}>
                    <IconButton
                      color="error"
                      onClick={() => {
                        const next = filters.length === 1 ? [{ ...emptyFilter }] : filters.filter((_, itemIndex) => itemIndex !== index);
                        setFilters(next);
                        // Refresh options for remaining filters
                        next.forEach((f) => {
                          if (f.field) fetchCascadingOptions(f.field, next);
                        });
                      }}
                    >
                      <Delete />
                    </IconButton>
                  </Grid>
                </React.Fragment>
              );
            })}

            <Grid item xs={12}>
              <Button
                variant="contained"
                startIcon={<Search />}
                disabled={loading}
                onClick={searchRows}
              >
                {loading ? "Loading..." : "Load Matching Employees"}
              </Button>
            </Grid>
          </Grid>
        </Paper>

        <Paper sx={{ p: 1, overflowX: "auto" }}>
          <DataGrid
            rows={rows}
            getRowId={(row) => row._id}
            columns={columns}
            loading={loading}
            checkboxSelection
            rowSelectionModel={selectedRows}
            onRowSelectionModelChange={(model) => setSelectedRows(model)}
            autoHeight
            getRowHeight={() => "auto"}
            slots={{ toolbar: GridToolbar }}
            slotProps={{
              toolbar: {
                showQuickFilter: true,
                csvOptions: { fileName: "employee_master_data" }
              }
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            sx={{
              "& .MuiDataGrid-cell": {
                alignItems: "flex-start",
                py: 1,
                whiteSpace: "normal"
              }
            }}
          />
        </Paper>
      </Box>
    </MenuPageShell>
  );
}
