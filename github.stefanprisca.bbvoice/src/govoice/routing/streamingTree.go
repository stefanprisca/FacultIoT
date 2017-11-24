package routing

import (
	"fmt"
	"io"
)

const branchFactor = 2

type StreamingTree struct {
	Root     string
	Children []*StreamingTree
}

func AddChild(st *StreamingTree, childId string) string {
	parent := FindFreeStreamer(st)
	//log.Printf("Adding child with id <%s> in tree id <%s> under streamer <%s>", childId, st.Root, parent.Root)
	parent.Children = append(parent.Children, &StreamingTree{Root: childId})
	return parent.Root
}

func FindFreeStreamer(st *StreamingTree) *StreamingTree {
	queue := []*StreamingTree{st}

	for {
		if len(queue) == 0 {
			break
		}
		root := queue[0]
		queue = queue[1:]
		if root.Children == nil {
			root.Children = []*StreamingTree{}
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

func NewStreamingTree(id string, existingTrees []StreamingTree) *StreamingTree {
	/*	TODO:
		1-Optional) Find free streamers in other trees => these will be the prefered streamers in the new tree
		2) Create new tree starting from the list of prefered streamers.
	*/

	roots := getTreeRoots(existingTrees)
	treeNodes := append([]string{id}, roots...)
	return createTree(treeNodes)
}

func getTreeRoots(trees []StreamingTree) []string {
	result := []string{}
	for _, t := range trees {
		result = append(result, t.Root)
	}
	return result
}

func createTree(treeNodes []string) *StreamingTree {
	streamingTree := &StreamingTree{Root: treeNodes[0]}
	for _, node := range treeNodes[1:] {
		AddChild(streamingTree, node)
	}
	return streamingTree
}

func PrettyPrintTree(tree StreamingTree, level int, out io.Writer) {
	increment := ""
	for i := 0; i < level; i++ {
		increment += "| "
	}
	fmt.Fprintf(out, "%s> %s\n", increment, tree.Root)

	if tree.Children == nil {
		return
	}

	for _, child := range tree.Children {
		PrettyPrintTree(*child, level+1, out)
	}
}
