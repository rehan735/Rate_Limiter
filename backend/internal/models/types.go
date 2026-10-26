package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// JSONB is a PostgreSQL JSONB-compatible type for arbitrary metadata.
type JSONB map[string]interface{}

func (j JSONB) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

func (j *JSONB) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return fmt.Errorf("JSONB: cannot scan type %T", value)
	}
	return json.Unmarshal(bytes, j)
}

// StringArray is a PostgreSQL text[]-compatible type.
type StringArray []string

func (s StringArray) Value() (driver.Value, error) {
	if s == nil {
		return "{}", nil
	}
	// Format as PostgreSQL array literal: {"a","b","c"}
	result := "{"
	for i, v := range s {
		if i > 0 {
			result += ","
		}
		// Escape double quotes and backslashes
		escaped := ""
		for _, c := range v {
			if c == '"' || c == '\\' {
				escaped += "\\"
			}
			escaped += string(c)
		}
		result += `"` + escaped + `"`
	}
	result += "}"
	return result, nil
}

func (s *StringArray) Scan(value interface{}) error {
	if value == nil {
		*s = nil
		return nil
	}
	var str string
	switch v := value.(type) {
	case []byte:
		str = string(v)
	case string:
		str = v
	default:
		return fmt.Errorf("StringArray: cannot scan type %T", value)
	}
	// Parse PostgreSQL array literal
	*s = parsePostgresArray(str)
	return nil
}

func parsePostgresArray(s string) []string {
	if s == "{}" || s == "" {
		return []string{}
	}
	// Remove outer braces
	s = s[1 : len(s)-1]
	if s == "" {
		return []string{}
	}
	var result []string
	var current string
	inQuotes := false
	escaped := false

	for _, c := range s {
		if escaped {
			current += string(c)
			escaped = false
			continue
		}
		if c == '\\' && inQuotes {
			escaped = true
			continue
		}
		if c == '"' {
			inQuotes = !inQuotes
			continue
		}
		if c == ',' && !inQuotes {
			result = append(result, current)
			current = ""
			continue
		}
		current += string(c)
	}
	if current != "" || len(result) > 0 {
		result = append(result, current)
	}
	return result
}
