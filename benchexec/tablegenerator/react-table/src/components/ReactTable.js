// This file is part of BenchExec, a framework for reliable benchmarking:
// https://github.com/sosy-lab/benchexec
//
// SPDX-FileCopyrightText: 2019-2020 Dirk Beyer <https://www.sosy-lab.org>
//
// SPDX-License-Identifier: Apache-2.0

import React, {
  useState,
  useEffect,
  memo,
  useMemo,
  useCallback,
  useRef,
} from "react";
import ReactTable from "react-table";
import "react-table/react-table.css";
import withFixedColumns from "react-table-hoc-fixed-columns";
import "react-table-hoc-fixed-columns/lib/styles.css";
import "react-table/react-table.css";
import {
  createRunSetColumns,
  StandardCell,
  StandardColumnHeader,
  SelectColumnsButton,
} from "./TableComponents.js";
import {
  isNumericColumn,
  numericSortMethod,
  textSortMethod,
  determineColumnWidth,
  pathOr,
  emptyStateValue,
  isNil,
  hasSameEntries,
  setParam,
  getHashSearch,
} from "../utils/utils";

const numericPattern = "([+-]?[0-9]*(\\.[0-9]*)?)(:[+-]?[0-9]*(\\.[0-9]*)?)?";

// Special markers we use as category for empty run results
const RUN_ABORTED = "aborted"; // result tag was present but empty (failure)
const RUN_EMPTY = "empty"; // result tag was not present in results XML
const SPECIAL_CATEGORIES = { [RUN_EMPTY]: "Empty rows", [RUN_ABORTED]: "—" };

const ReactTableFixedColumns = withFixedColumns(ReactTable);

const getSortingSettingsFromURL = () => {
  const urlParams = getHashSearch();
  let settings = urlParams.sort
    ? urlParams.sort.split(";").map((sortingEntry) => {
        const sortingParams = sortingEntry.split(",");
        const id = sortingParams[0];
        const desc = sortingParams[1] === "desc";
        return { id, desc };
      })
    : [];
  return settings;
};

const initialPageSize = 250;
const getPageSizeFromURL = () =>
  parseInt(getHashSearch().pageSize) || initialPageSize;

const debounceTime = 500;
const TableRender = (props) => {
  const [fixed, setFixed] = useState(true);
  let [filteredColumnValues, setFilteredColumnValues] = useState({});
  let [disableTaskText, setDisableTaskText] = useState(false);
  let [sortingSettings, setSortingSettings] = useState();
  let [pageSize, setPageSize] = useState(initialPageSize);

  const onFilterChanged = (key, filterValue) => {
    let updatedOldValue = false;
    let filtered = props.filtered.map((filter) => {
      if (filter.id === key) {
        updatedOldValue = true;
        return { id: key, value: filterValue };
      }
      return filter;
    });
    if (!updatedOldValue) {
      filtered.push({ id: key, value: filterValue });
    }
    /* There may be filters without values left over when the filter tab
         overrides the table tab filters. Remove those if any exist. */
    filtered = filtered.filter((filter) => filter.value);
    // We only want to consider filters that were set by ReactTable on this update
    const newFilters = filtered.filter(
      (filter) => !props.filtered.includes(filter),
    );

    filtered
      .filter((filter) => filter.id === "id")
      .forEach((filter) => {
        filter.isTableTabFilter = true;
      });

    let filteredCopy = [...filtered];

    let additionalFilters = [];

    // We are only interested in applying additional filters based on status filters
    const statusFilter = newFilters.filter(({ id, value }) =>
      id.includes("status"),
    );
    if (statusFilter && statusFilter.length) {
      const parsed = statusFilter.map(({ id, value }) => {
        const [tool, name, column] = id.split("_");
        return {
          tool,
          name,
          column,
          value,
        };
      });

      for (const { tool, name, column, value } of parsed) {
        if (value.trim() === "all") {
          additionalFilters = selectAllStatusFields({
            tool,
            name,
            column,
          });
          filteredCopy = filteredCopy.filter(
            ({ id, value }) =>
              !(id === `${tool}_${name}_${column}` && value.trim() === "all"),
          );
        } else {
          const isCategory = value[value.length - 1] === " ";
          additionalFilters = createAdditionalFilters({
            tool,
            name,
            column,
            isCategory,
          });
        }
      }
    }
    props.filterPlotData([...filteredCopy, ...additionalFilters], true);
  };

  function FilterInputField(props) {
    const elementId = props.column.id + "_filter";
    const filter = props.filter ? props.filter.value : props.filter;
    let value;
    let typingTimer;

    const textPlaceHolder =
      props.column.id === "id" && disableTaskText
        ? "To edit, please clear task filter in the sidebar"
        : "text";

    const onChange = (event) => {
      value = event.target.value;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        onFilterChanged(props.column.id, value);
        document.getElementById(elementId).focus();
      }, debounceTime);
    };

    return (
      <input
        id={elementId}
        placeholder={props.numeric ? "Min:Max" : textPlaceHolder}
        defaultValue={value ? value : filter}
        onChange={onChange}
        disabled={props.column.id === "id" ? disableTaskText : false}
        type="search"
        pattern={props.numeric ? numericPattern : undefined}
      />
    );
  }

  // get selected status and category values
  useEffect(() => {
    const { filtered } = props;
    const newFilteredColumnValues = {};
    for (const filter of filtered) {
      const { value, values, id } = filter;
      if (id === "id") {
        if (!isNil(values)) {
          console.log("setDisableTaskText(true)");
          setDisableTaskText(true);
        } else {
          console.log("setDisableTaskText(false)");

          setDisableTaskText(false);
        }
      }
      const [runset, , column] = id.split("_");
      const currentRunsetFilters = newFilteredColumnValues[runset] || {};

      const isCategory =
        typeof value === "string" && value[value.length - 1] === " ";

      if (isCategory) {
        const categories = currentRunsetFilters.categories || [];
        categories.push(value);
        currentRunsetFilters.categories = categories;
      } else {
        const filtersOfColumn = currentRunsetFilters[column] || [];
        filtersOfColumn.push(value);
        currentRunsetFilters[column] = filtersOfColumn;
      }

      newFilteredColumnValues[runset] = currentRunsetFilters;
    }
    console.log("setFilteredColumnValues");
    setFilteredColumnValues(newFilteredColumnValues);

    const sortingSetting = getSortingSettingsFromURL();
    console.log("setSortingSettings");
    setSortingSettings(sortingSetting);

    const pageSize = getPageSizeFromURL();
    console.log("setPageSize");
    setPageSize(pageSize);
  }, [props.filtered]);

  const handleFixedInputChange = ({ target }) => {
    const value = target.checked;
    console.log("setting fixed");
    setFixed(value);
  };

  const createTaskIdColumn = () => ({
    Header: () => (
      <div className="fixed">
        <form>
          <label title="Fix the first column">
            Fixed task:
            <input
              name="fixed"
              type="checkbox"
              checked={fixed}
              onChange={handleFixedInputChange}
            />
          </label>
        </form>
      </div>
    ),
    fixed: fixed ? "left" : "",
    columns: [
      {
        minWidth: window.innerWidth * 0.3,
        Header: (
          <StandardColumnHeader>
            <SelectColumnsButton handler={props.selectColumn} />
          </StandardColumnHeader>
        ),
        fixed: fixed ? "left" : "",
        accessor: "id",
        Cell: (cell) => {
          const content = cell.value.map((id) => (
            <span key={id} className="row_id">
              {id}
            </span>
          ));
          const href = cell.original.href;
          return href ? (
            <a
              key={href}
              className="row__name--cellLink"
              href={href}
              title="Click here to show source code"
              onClick={(ev) => props.toggleLinkOverlay(ev, href)}
            >
              {content}
            </a>
          ) : (
            <span title="This task has no associated file">{content}</span>
          );
        },
        filterMethod: (filter, row) => {
          return true;
        },
        Filter: FilterInputField,
      },
    ],
  });

  /**
   * @typedef {Object} RelevantFilterParam
   * @property {string[]} categoryFilters - The category filters that are currently selected
   * @property {string[]} statusFilters - The status filters that are currently selected
   * @property {string[]} categoryFilterValues - All selectable category filter values
   * @property {string[]} statusFilterValues - All selectable status filter values
   */

  /**
   * Function to extract the label of relevant filters to display.
   * If, for example, all category values are set and selected status values are "true" and "pass",
   * then only these status values will be displayed to the user as the category values have no
   * impact on filtering.
   *
   * @param {RelevantFilterParam} options
   * @returns {string[]} The labels to display to the user
   */
  const createRelevantFilterLabel = ({
    categoryFilters,
    statusFilters,
    categoryFilterValues,
    statusFilterValues,
  }) => {
    let out = [];

    if (!hasSameEntries(categoryFilters, categoryFilterValues)) {
      //if categoryFilters is a superset of categoryFilterValues, we know that all categories are selected
      out = categoryFilters;
    }
    if (!hasSameEntries(statusFilters, statusFilterValues)) {
      //if statusFilters is a superset of statusFilterValues, we know that all statuses are selected
      out = [...out, ...statusFilters];
    }

    return out;
  };

  const createStatusColumn = useMemo(() => {
    console.log("createStatusColumn");
    return (runSetIdx, column, columnIdx) => ({
      id: `${runSetIdx}_${column.display_title}_${columnIdx}`,
      Header: <StandardColumnHeader column={column} />,
      show: !props.hiddenCols[runSetIdx].includes(column.colIdx),
      minWidth: determineColumnWidth(column, 10),
      accessor: (row) => row.results[runSetIdx].values[columnIdx],
      Cell: (cell) => {
        const category = cell.original.results[runSetIdx].category;
        let href = cell.original.results[runSetIdx].href;
        let tooltip;
        if (category === "aborted") {
          href = undefined;
          tooltip = "Result missing because run was aborted or not executed";
        } else if (category === "empty") {
          tooltip = "Result missing because task was not part of benchmark set";
        } else if (href) {
          tooltip = "Click here to show output of tool";
        }
        return (
          <StandardCell
            cell={cell}
            href={href}
            className={category}
            toggleLinkOverlay={props.toggleLinkOverlay}
            title={tooltip}
            force={true}
          />
        );
      },
      sortMethod: textSortMethod,
      filterMethod: (filter, row) => {
        return true;
      },
      Filter: ({ filter, onChange, column }) => {
        const categoryValues = props.categoryValues[runSetIdx][columnIdx];
        const selectedCategoryFilters = pathOr(
          [runSetIdx, "categories"],
          [],
          filteredColumnValues,
        );
        const selectedStatusValues = pathOr(
          [runSetIdx, columnIdx],
          [],
          filteredColumnValues,
        );
        const selectedFilters = createRelevantFilterLabel({
          categoryFilters: selectedCategoryFilters,
          statusFilters: selectedStatusValues,
          categoryFilterValues: categoryValues.map((item) => `${item} `),
          statusFilterValues: props.statusValues[runSetIdx][columnIdx],
        });

        const multipleSelected =
          selectedFilters.length > 1 || selectedFilters[0] === emptyStateValue;

        const allSelected = selectedFilters.length === 0;

        const singleFilterValue = selectedFilters && selectedFilters[0];
        const selectValue = multipleSelected ? "multiple" : singleFilterValue;
        return (
          <select
            onChange={(event) => onFilterChanged(column.id, event.target.value)}
            style={{ width: "100%" }}
            value={
              (allSelected && "all ") ||
              (multipleSelected && "multiple") ||
              selectValue
            }
          >
            {multipleSelected && (
              <option value="multiple" disabled>
                {selectedFilters
                  .map((x) => x.trim())
                  .filter((x) => x !== "all" && x !== emptyStateValue)
                  .join(", ") || "No filters selected"}
              </option>
            )}
            <option value="all ">Show all</option>
            {categoryValues
              .filter((category) => category in SPECIAL_CATEGORIES)
              .map((category) => (
                // category filters are marked with space at end
                <option value={category + " "} key={category}>
                  {SPECIAL_CATEGORIES[category]}
                </option>
              ))}
            <optgroup label="Category">
              {categoryValues
                .filter((category) => !(category in SPECIAL_CATEGORIES))
                .map((category) => (
                  // category filters are marked with space at end
                  <option value={category + " "} key={category}>
                    {category}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Status">
              {props.statusValues[runSetIdx][columnIdx].map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </optgroup>
          </select>
        );
      },
    });
  }, [
    filteredColumnValues,
    props.categoryValues,
    props.hiddenCols,
    props.statusValues,
    props.toggleLinkOverlay,
  ]);

  const createColumn = useMemo(() => {
    console.log("createColumn");
    return (runSetIdx, column, columnIdx) => {
      if (column.type === "status") {
        return createStatusColumn(runSetIdx, column, columnIdx);
      }

      return {
        id: `${runSetIdx}_${column.display_title}_${columnIdx}`,
        Header: <StandardColumnHeader column={column} />,
        show: !props.hiddenCols[runSetIdx].includes(column.colIdx),
        minWidth: determineColumnWidth(column),
        accessor: (row) => row.results[runSetIdx].values[columnIdx],
        Cell: (cell) => (
          <StandardCell
            cell={cell}
            toggleLinkOverlay={props.toggleLinkOverlay}
          />
        ),
        filterMethod: () => true,
        Filter: (filter) => (
          <FilterInputField numeric={isNumericColumn(column)} {...filter} />
        ),
        sortMethod: isNumericColumn(column)
          ? numericSortMethod
          : textSortMethod,
      };
    };
  }, [createStatusColumn, props.toggleLinkOverlay, props.hiddenCols]);

  const resultColumns = useMemo(
    () =>
      console.log("resultColumns") ||
      props.tools
        .map((runSet, runSetIdx) =>
          createRunSetColumns(runSet, runSetIdx, createColumn),
        )
        .flat(),
    [props.tools, createColumn],
  );

  /**
   * This function automatically creates additional filters for status or category filters.
   * This is due to the fact that status and category filters are AND connected.
   * As only one status or category at a time can be selected in the Table view, this would
   * result in Filters like
   *      <Status X> AND <no categories>
   *  or
   *      <no status> AND <Category Y>
   *
   * which would always result in an empty result set.
   *
   */
  const createAdditionalFilters = ({ tool, name, column, isCategory }) => {
    const fill = isCategory ? props.statusValues : props.categoryValues;
    const out = [];

    for (const val of fill[tool][column]) {
      out.push({
        id: `${tool}_${name}_${column}`,
        value: `${val}${isCategory ? "" : " "}`,
      });
    }
    return out;
  };

  const selectAllStatusFields = ({ tool, name, column }) => {
    const out = [];

    for (const val of props.statusValues[tool][column]) {
      const value = val;
      out.push({
        id: `${tool}_${name}_${column}`,
        value,
      });
    }
    for (const val of props.categoryValues[tool][column]) {
      const value = `${val} `;
      out.push({
        id: `${tool}_${name}_${column}`,
        value, // categories are identified by the trailing space
      });
    }
    return out;
  };

  console.log({ filtered: props.filtered });

  return (
    <div className="mainTable">
      <ReactTableFixedColumns
        data={props.data}
        filterable={true}
        columns={[createTaskIdColumn()].concat(resultColumns)}
        defaultSorted={sortingSettings}
        onSortedChange={(sorted) => {
          const sort = sorted
            .map(
              (sortingEntry) =>
                sortingEntry.id + "," + (sortingEntry.desc ? "desc" : "asc"),
            )
            .join(";");
          setParam({ sort });
        }}
        defaultPageSize={250}
        pageSize={pageSize}
        pageSizeOptions={[50, 100, 250, 500, 1000, 2500]}
        className="-highlight"
        minRows={0}
        onPageSizeChange={(pageSize) => setParam({ pageSize })}
      />
    </div>
  );
};

const Table = memo(TableRender);

export default Table;
