package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"go.mongodb.org/mongo-driver/bson"

	"niuma/services/mongodb-service/internal/session"
)

type monitorStreamStartParams struct {
	SessionID  string            `json:"sessionId"`
	Database   string            `json:"database"`
	Collection string            `json:"collection"`
	Pipeline   []json.RawMessage `json:"pipeline"`
}

type streamIDParams struct {
	StreamID string `json:"streamId"`
}

func (d *Dispatcher) monitorStreamStart(ctx context.Context, req Request) Response {
	var params monitorStreamStartParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if _, resp, ok := d.requireSession(req.ID, params.SessionID); !ok {
		return resp
	}
	pipeline := make([]bson.M, 0, len(params.Pipeline))
	for _, stage := range params.Pipeline {
		doc, err := session.ParseDocument(stage)
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
		pipeline = append(pipeline, doc)
	}
	streamID, err := d.streams.Start(ctx, params.SessionID, params.Database, params.Collection, pipeline)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"streamId": streamID})
}

func (d *Dispatcher) monitorStreamStop(_ context.Context, req Request) Response {
	var params streamIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.StreamID == "" {
		return errorResponse(req.ID, "streamId required")
	}
	if err := d.streams.Stop(params.StreamID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"stopped": true})
}
