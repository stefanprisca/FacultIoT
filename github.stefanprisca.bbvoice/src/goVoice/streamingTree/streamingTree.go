package streamingTree

import (
	"log"
)

const branchFactor = 2

type StreamingTree struct {
	Root     string
	Children []StreamingTree
}

func (st StreamingTree) AddChild(childId string) StreamingTree {
	st.Children = append(st.Children, StreamingTree{Root: childId})
	return st
}

func FindFreeStreamers(streamingTrees []StreamingTree) []string {
	streamers := []string{}

	for _, st := range streamingTrees {
		log.Printf("looking for streamers: %v %v\n", st.Root, st.Children)
		streamers = append(streamers, findFreeStreamer(st))
	}

	log.Printf("Found free streamers: %v(%d) \n", streamers, len(streamers))
	return streamers
}

func findFreeStreamer(st StreamingTree) string {
	queue := []StreamingTree{st}

	for {
		if len(queue) == 0 {
			break
		}
		root := queue[0]
		queue = queue[1:]

		if len(root.Children) < branchFactor {
			return root.Root
		}

		for _, child := range root.Children {
			queue = append(queue, child)
		}
	}

	return ""
}
