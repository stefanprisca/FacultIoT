package routing

import (
	"fmt"
	"io"
)

const branchFactor = 2

type streamingTree struct {
	Root     string
	Children []*streamingTree
}

func addChild(st *streamingTree, childID string) string {
	parent := findFreeStreamer(st)
	parent.Children = append(parent.Children, &streamingTree{Root: childID})
	return parent.Root
}

func findFreeStreamer(st *streamingTree) *streamingTree {
	queue := []*streamingTree{st}

	for {
		if len(queue) == 0 {
			break
		}
		root := queue[0]
		queue = queue[1:]
		if root.Children == nil {
			root.Children = []*streamingTree{}
			return root
		}

		if len(root.Children) < branchFactor {
			return root
		}

		for _, child := range root.Children {
			queue = append(queue, child)
		}
	}

	return nil
}

func deleteChild(st *streamingTree, childID string) []*streamingTree {
	if st.Children == nil {
		return nil
	}

	newChildren := []*streamingTree{}
	orphans := []*streamingTree{}
	for _, c := range st.Children {
		if c.Root == childID {
			orphans = append(orphans, c.Children...)
			continue
		}
		orphans = append(orphans, deleteChild(c, childID)...)
		newChildren = append(newChildren, c)
	}

	st.Children = newChildren
	return orphans
}

func newStreamingTree(id string, existingTrees []streamingTree) *streamingTree {
	/*	TODO:
		1-Optional) Find free streamers in other trees => these will be the prefered streamers in the new tree
		2) Create new tree starting from the list of prefered streamers.
	*/

	roots := getTreeRoots(existingTrees)
	treeNodes := append([]string{id}, roots...)
	return createTree(treeNodes)
}

func getTreeRoots(trees []streamingTree) []string {
	result := []string{}
	for _, t := range trees {
		result = append(result, t.Root)
	}
	return result
}

func createTree(treeNodes []string) *streamingTree {
	streamingTree := &streamingTree{Root: treeNodes[0]}
	for _, node := range treeNodes[1:] {
		addChild(streamingTree, node)
	}
	return streamingTree
}

func prettyPrintTree(tree streamingTree, level int, out io.Writer) {
	increment := ""
	for i := 0; i < level; i++ {
		increment += "| "
	}
	fmt.Fprintf(out, "%s> %s\n", increment, tree.Root)

	if tree.Children == nil {
		return
	}

	for _, child := range tree.Children {
		prettyPrintTree(*child, level+1, out)
	}
}
