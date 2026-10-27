// Every public package under ts/packages, dependencies first: packing builds each package against
// its dependencies' declarations, and a release publishes them in this order.
export const packages = ['ledger', 'popup', 'ceremony', 'ens']
