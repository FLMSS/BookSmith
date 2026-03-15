export async function activateView(app: any, viewType: string, direction: 'left' | 'right') {
	const { workspace } = app;
	
	// Check if the view is already open
	let leaf = null;
	const leaves = workspace.getLeavesOfType(viewType);
		
	if (leaves.length > 0) {
		// If the view is already open, activate it
		leaf = leaves[0];
	} else {
		// If the view is not open, create a new one
		leaf = direction === 'left'
			? workspace.getLeftLeaf(false)
			: workspace.getRightLeaf(false);
	}
	
	// Add null check
	if (leaf) {
		await leaf.setViewState({
			type: viewType,
			active: true,
		});
		
		// Reveal/activate the leaf
		workspace.revealLeaf(leaf);
	}
}