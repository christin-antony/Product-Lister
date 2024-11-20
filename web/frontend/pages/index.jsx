import React, { useState, useCallback, useEffect } from 'react';
import {
  Page,
  LegacyCard,
  IndexTable,
  IndexFilters,
  useSetIndexFiltersMode,
  useIndexResourceState,
  Text,
  ChoiceList,
  Badge,
  Button,
  Pagination,
  TextField,
  Modal,
  Layout,
  TextContainer,
  ButtonGroup,
} from '@shopify/polaris';

import { useAuthenticatedFetch } from '../hooks';

function DynamicProductLister() {
  const fetch = useAuthenticatedFetch();
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vendors, setVendors] = useState([]);


  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;


  const [itemStrings] = useState(['All Products']);
  const [selected, setSelected] = useState(0);
  const [queryValue, setQueryValue] = useState('');
  const { mode, setMode } = useSetIndexFiltersMode();
  const [sortSelected, setSortSelected] = useState(['title asc']);


  const [statusFilter, setStatusFilter] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]);


  const [priceAdjustment, setPriceAdjustment] = useState('');
  const [adjustmentType, setAdjustmentType] = useState(['up']);
  const [modalActive, setModalActive] = useState(false);
  const [status, setStatus] = useState('');
  

  const [undoModalActive, setUndoModalActive] = useState(false);
  const [undoStatus, setUndoStatus] = useState('');
  const [undoSteps, setUndoSteps] = useState(1);

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
  } = useIndexResourceState(filteredProducts);

  const fetchProducts = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/products');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data.products)) {
        throw new Error('Products data not found or is not an array');
      }

      const transformedProducts = data.products.map(product => ({
        ...product,
        priceData: product.variants.map(variant => ({
          variantId: variant.id,
          currentPrice: parseFloat(variant.price) || 0,
          oldPrice: variant.old_price ? parseFloat(variant.old_price) : null,
          inventory_quantity: variant.inventory_quantity || 0
        }))[0]
      }));

      setProducts(transformedProducts);
      setFilteredProducts(transformedProducts);
      
      const uniqueVendors = [...new Set(transformedProducts.map(product => product.vendor))]
        .filter(Boolean)
        .sort();
      setVendors(uniqueVendors);
    } catch (error) {
      console.error('Error fetching products:', error);
      setError('Failed to load products. Please try again later.');
    } finally {
      setLoading(false);
    }
  };


  const handleUndoPriceChanges = async () => {
    if (!selectedResources.length) {
      setUndoStatus('Please select products to undo price changes.');
      return;
    }
  
    setUndoStatus('Reverting price changes...');
    
    try {
      const stringProductIds = selectedResources.map(id => id.toString());
      
      const response = await fetch('/api/undo-price-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: stringProductIds,
          steps: parseInt(undoSteps)
        }),
      });
  
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to undo price changes');
      }
  
      const data = await response.json();
  
      if (data.success) {
        setUndoStatus(`Successfully reverted ${data.summary.successful_updates} prices by ${data.summary.steps_undone} steps.`);
        if (data.summary.failed_updates > 0) {
          setUndoStatus(prev => `${prev} ${data.summary.failed_updates} updates failed.`);
        }
        await fetchProducts();
        setTimeout(() => {
          setUndoModalActive(false);
          setUndoStatus('');
        }, 2000);
      } else {
        throw new Error(data.message || 'Failed to undo price changes');
      }
    } catch (error) {
      console.error('Error undoing price changes:', error);
      setUndoStatus(`Failed to undo price changes: ${error.message}`);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    filterProducts();
  }, [statusFilter, vendorFilter, queryValue, products, sortSelected]);

   const filterProducts = () => {
    let filtered = [...products];

    if (statusFilter.length > 0) {
      filtered = filtered.filter(product => statusFilter.includes(product.status));
    }

    if (vendorFilter.length > 0) {
      filtered = filtered.filter(product => vendorFilter.includes(product.vendor));
    }

    if (queryValue) {
      const searchLower = queryValue.toLowerCase();
      filtered = filtered.filter(product =>
        product.title.toLowerCase().includes(searchLower)
      );
    }

    
    if (sortSelected.includes('title asc')) {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortSelected.includes('title desc')) {
      filtered.sort((a, b) => b.title.localeCompare(a.title));
    }

    setFilteredProducts(filtered);
    setCurrentPage(1);
  };

  const handlePriceAdjustment = async () => {
    if (!selectedResources.length || !priceAdjustment) {
      setStatus('Please select products and enter a valid percentage.');
      return;
    }

    const adjustmentValue = parseFloat(priceAdjustment);
    if (isNaN(adjustmentValue) || adjustmentValue <= 0) {
      setStatus('Please enter a valid positive number for the adjustment.');
      return;
    }

    setStatus('Updating prices...');
    
    try {
      const stringProductIds = selectedResources.map(id => id.toString());
      
      const response = await fetch('/api/adjust-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: stringProductIds,
          percentage: adjustmentValue,
          adjustmentType: adjustmentType[0],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update prices');
      }

      const data = await response.json();

      if (data.success) {
        setStatus(`Successfully updated ${data.summary.successful_updates} prices.`);
        if (data.summary.failed_updates > 0) {
          setStatus(prev => `${prev} ${data.summary.failed_updates} updates failed.`);
        }
        await fetchProducts();
        setTimeout(() => {
          setModalActive(false);
          setPriceAdjustment('');
          setStatus('');
        }, 2000);
      } else {
        throw new Error(data.message || 'Failed to update prices');
      }
    } catch (error) {
      console.error('Error adjusting prices:', error);
      setStatus(`Failed to update prices: ${error.message}`);
    }
  };


  const handleStatusFilterChange = useCallback((value) => setStatusFilter(value), []);
  const handleVendorFilterChange = useCallback((value) => setVendorFilter(value), []);
  const handleFiltersQueryChange = useCallback((value) => setQueryValue(value), []);
  const handleFiltersClearAll = useCallback(() => {
    setStatusFilter([]);
    setVendorFilter([]);
    setQueryValue('');
  }, []);

  const handleNextPage = useCallback(
    () => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE))),
    [filteredProducts.length]
  );

  const handlePreviousPage = useCallback(
    () => setCurrentPage(prev => Math.max(prev - 1, 1)),
    []
  );

  const getCurrentPageItems = () => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredProducts.slice(startIndex, endIndex);
  };

  const rowMarkup = getCurrentPageItems().map(
    ({ id, title, priceData, status, vendor }, index) => (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {title}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          ${priceData?.currentPrice?.toFixed(2) || '0.00'}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {priceData?.oldPrice ? `$${priceData.oldPrice.toFixed(2)}` : '___'}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {priceData?.inventory_quantity || 0}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge status={status === 'active' ? 'success' : 'attention'}>
            {status || 'draft'}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{vendor}</IndexTable.Cell>
      </IndexTable.Row>
    )
  );

    const filters = [
    {
      key: 'status',
      label: 'Status',
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: 'Active', value: 'active' },
            { label: 'Draft', value: 'draft' },
          ]}
          selected={statusFilter}
          onChange={handleStatusFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
    {
      key: 'vendor',
      label: 'Vendor',
      filter: (
        <ChoiceList
          title="Vendor"
          titleHidden
          choices={vendors.map(vendor => ({
            label: vendor,
            value: vendor,
          }))}
          selected={vendorFilter}
          onChange={handleVendorFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [
    ...(statusFilter.length > 0 ? [{
      key: 'status',
      label: statusFilter.join(', '),
      onRemove: () => setStatusFilter([]),
    }] : []),
    ...(vendorFilter.length > 0 ? [{
      key: 'vendor',
      label: vendorFilter.join(', '),
      onRemove: () => setVendorFilter([]),
    }] : []),
  ];

  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const currentStartIndex = (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const currentEndIndex = Math.min(currentPage * ITEMS_PER_PAGE, filteredProducts.length);


  return (
    <Page title="Products">
      <LegacyCard>
        <IndexFilters
          sortOptions={[
            { label: 'Product Title', value: 'title asc', directionLabel: 'A-Z' },
            { label: 'Product Title', value: 'title desc', directionLabel: 'Z-A' },
          ]}
          sortSelected={sortSelected}
          queryValue={queryValue}
          queryPlaceholder="Search products"
          onQueryChange={handleFiltersQueryChange}
          onQueryClear={() => setQueryValue('')}
          filters={filters}
          appliedFilters={appliedFilters}
          onClearAll={handleFiltersClearAll}
          tabs={[{ content: 'All Products', index: 0 }]}
          selected={selected}
          onSelect={setSelected}
          mode={mode}
          setMode={setMode}
        />

        <LegacyCard.Section>
          {loading ? (
            <Text variant="bodyMd" as="p">Loading products...</Text>
          ) : error ? (
            <Text variant="bodyMd" as="p" color="critical">{error}</Text>
          ) : (
            <>
              {selectedResources.length > 0 && (
                <Layout>
                  <Layout.Section>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                      <ButtonGroup>
                        <Button onClick={() => setModalActive(true)} primary>
                          Adjust Prices ({selectedResources.length} selected)
                        </Button>
                        <Button onClick={() => setUndoModalActive(true)}>
                          Undo Price Changes
                        </Button>
                      </ButtonGroup>
                    </div>
                  </Layout.Section>
                </Layout>
              )}
              
              <IndexTable
                resourceName={{ singular: 'product', plural: 'products' }}
                itemCount={filteredProducts.length}
                selectedItemsCount={selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: 'Product' },
                  { title: 'Current Price' },
                  { title: 'Old Price' },
                  { title: 'Stock' },
                  { title: 'Status' },
                  { title: 'Vendor' },
                ]}
              >
                {rowMarkup}
              </IndexTable>

              <div style={{ padding: '16px', display: 'flex', justifyContent: 'center' }}>
                <Pagination
                  hasNext={currentPage < totalPages}
                  hasPrevious={currentPage > 1}
                  onNext={handleNextPage}
                  onPrevious={handlePreviousPage}
                  label={`${currentStartIndex}-${currentEndIndex} of ${filteredProducts.length} products`}
                />
              </div>
            </>
          )}
        </LegacyCard.Section>
      </LegacyCard>

    
      <Modal
        open={modalActive}
        onClose={() => {
          setModalActive(false);
          setStatus('');
        }}
        title="Apply Price Adjustment"
        primaryAction={{
          content: 'Apply Adjustment',
          onAction: handlePriceAdjustment,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => {
            setModalActive(false);
            setStatus('');
          }
        }]}
      >
        <Modal.Section>
          <TextContainer>
            <TextField
              label="Price Adjustment Percentage"
              value={priceAdjustment}
              onChange={setPriceAdjustment}
              type="number"
              helpText="Enter a positive number. Example: 10 for 10%"
              autoComplete="off"
            />
            <ChoiceList
              title="Adjustment Type"
              choices={[
                { label: 'Price Up', value: 'up' },
                { label: 'Price Down', value: 'down' }
              ]}
              selected={adjustmentType}
              onChange={value => setAdjustmentType(value)}
            />
            {status && (
              <Text variant="bodyMd" as="p" color={status.includes('success') ? 'success' : 'critical'}>
                {status}
              </Text>
            )}
          </TextContainer>
        </Modal.Section>
      </Modal>

     
      <Modal
  open={undoModalActive}
  onClose={() => {
    setUndoModalActive(false);
    setUndoStatus('');
  }}
  title="Undo Price Changes"
  primaryAction={{
    content: 'Confirm Undo',
    onAction: handleUndoPriceChanges,
  }}
  secondaryActions={[{
    content: 'Cancel',
    onAction: () => {
      setUndoModalActive(false);
      setUndoStatus('');
    }
  }]}
>
  <Modal.Section>
    <TextContainer>
      <TextField
        label="Number of steps to undo"
        value={undoSteps}
        onChange={setUndoSteps}
        type="number"
        min="1"
        helpText="Enter how many price changes you want to undo"
        autoComplete="off"
      />
      
      {undoStatus && (
        <Text variant="bodyMd" as="p" color={undoStatus.includes('Successfully') ? 'success' : 'critical'}>
          {undoStatus}
        </Text>
      )}
    </TextContainer>
  </Modal.Section>
</Modal>
    </Page>
  );
}

export default DynamicProductLister;


