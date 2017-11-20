package streamingTree

import "log"

const branchFactor = 2

type StreamingTree struct {
	Root     string
	Children []*StreamingTree
}

func AddChild(st *StreamingTree, childId string) string {
	parent := FindFreeStreamer(st)
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

		log.Printf("Finding free streamer in %v", root)
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
