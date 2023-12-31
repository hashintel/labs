from __future__ import annotations
from graph_client.schema import OntologyTypeSchema
from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID
from pydantic import AnyUrl, BaseModel, ConfigDict, Field, RootModel

class AccountGroupId(RootModel[UUID]):
    model_config = ConfigDict(populate_by_name=True)
    root: UUID

class AccountGroupPermission(Enum):
    add_member = 'add_member'
    remove_member = 'remove_member'

class AccountId(RootModel[UUID]):
    model_config = ConfigDict(populate_by_name=True)
    root: UUID

class DataTypeOwnerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class DataTypeOwnerSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class DataTypeOwnerSubject(RootModel[DataTypeOwnerSubjectItem | DataTypeOwnerSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: DataTypeOwnerSubjectItem | DataTypeOwnerSubjectItem1 = Field(..., discriminator='kind')

class DataTypePermission(Enum):
    update = 'update'
    view = 'view'

class DataTypeQueryToken(Enum):
    """
    A single token in a [`DataTypeQueryPath`].
    """
    base_url = 'baseUrl'
    version = 'version'
    versioned_url = 'versionedUrl'
    owned_by_id = 'ownedById'
    record_created_by_id = 'recordCreatedById'
    record_archived_by_id = 'recordArchivedById'
    title = 'title'
    description = 'description'
    type = 'type'

class DataTypeRelationAndSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['owner']
    subject: DataTypeOwnerSubject

class DataTypeViewerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['public']

class DataTypeViewerSubject(RootModel[DataTypeViewerSubjectItem]):
    model_config = ConfigDict(populate_by_name=True)
    root: DataTypeViewerSubjectItem

class DecisionTime(RootModel[Literal['decisionTime']]):
    model_config = ConfigDict(populate_by_name=True)
    root: Literal['decisionTime'] = Field(..., description='Time axis for the decision time.\n\nThis is used as the generic argument to time-related structs and can be used as tag value.')

class EdgeResolveDepths(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    incoming: int = Field(..., ge=0)
    outgoing: int = Field(..., ge=0)

class EntityEditionId(RootModel[UUID]):
    model_config = ConfigDict(populate_by_name=True)
    root: UUID

class EntityEditorSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class EntityEditorSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class EntityEditorSubject(RootModel[EntityEditorSubjectItem | EntityEditorSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityEditorSubjectItem | EntityEditorSubjectItem1 = Field(..., discriminator='kind')

class EntityId(RootModel[str]):
    model_config = ConfigDict(populate_by_name=True)
    root: str

class EntityOwnerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class EntityOwnerSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class EntityOwnerSubject(RootModel[EntityOwnerSubjectItem | EntityOwnerSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityOwnerSubjectItem | EntityOwnerSubjectItem1 = Field(..., discriminator='kind')

class EntityPermission(Enum):
    update = 'update'
    view = 'view'

class EntityProperties(BaseModel):
    """
    The properties of an entity.

    When expressed as JSON, this should validate against its respective entity type(s).
    """
    model_config = ConfigDict(populate_by_name=True)

class EntityQueryToken(Enum):
    """
    A single token in an [`EntityQueryPath`].
    """
    uuid = 'uuid'
    edition_id = 'editionId'
    archived = 'archived'
    draft = 'draft'
    owned_by_id = 'ownedById'
    record_created_by_id = 'recordCreatedById'
    type = 'type'
    properties = 'properties'
    incoming_links = 'incomingLinks'
    outgoing_links = 'outgoingLinks'
    left_entity = 'leftEntity'
    right_entity = 'rightEntity'
    left_to_right_order = 'leftToRightOrder'
    right_to_left_order = 'rightToLeftOrder'

class EntityRecordId(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    edition_id: EntityEditionId = Field(..., alias='editionId')
    entity_id: EntityId = Field(..., alias='entityId')

class EntityRelationAndSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['owner']
    subject: EntityOwnerSubject

class EntityRelationAndSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['editor']
    subject: EntityEditorSubject

class EntityTypeInstantiatorSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class EntityTypeInstantiatorSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class EntityTypeInstantiatorSubjectItem2(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['public']

class EntityTypeInstantiatorSubject(RootModel[EntityTypeInstantiatorSubjectItem | EntityTypeInstantiatorSubjectItem1 | EntityTypeInstantiatorSubjectItem2]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityTypeInstantiatorSubjectItem | EntityTypeInstantiatorSubjectItem1 | EntityTypeInstantiatorSubjectItem2 = Field(..., discriminator='kind')

class EntityTypeOwnerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class EntityTypeOwnerSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class EntityTypeOwnerSubject(RootModel[EntityTypeOwnerSubjectItem | EntityTypeOwnerSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityTypeOwnerSubjectItem | EntityTypeOwnerSubjectItem1 = Field(..., discriminator='kind')

class EntityTypePermission(Enum):
    update = 'update'
    view = 'view'
    instantiate = 'instantiate'

class EntityTypeQueryToken(Enum):
    """
    A single token in a [`EntityTypeQueryPath`].
    """
    base_url = 'baseUrl'
    version = 'version'
    versioned_url = 'versionedUrl'
    owned_by_id = 'ownedById'
    record_created_by_id = 'recordCreatedById'
    record_archived_by_id = 'recordArchivedById'
    title = 'title'
    description = 'description'
    examples = 'examples'
    properties = 'properties'
    required = 'required'
    label_property = 'labelProperty'
    icon = 'icon'
    links = 'links'
    inherits_from = 'inheritsFrom'
    children = 'children'

class EntityTypeRelationAndSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['owner']
    subject: EntityTypeOwnerSubject

class EntityTypeRelationAndSubjectItem2(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['instantiator']
    subject: EntityTypeInstantiatorSubject

class EntityTypeViewerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['public']

class EntityTypeViewerSubject(RootModel[EntityTypeViewerSubjectItem]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityTypeViewerSubjectItem

class EntityUuid(RootModel[UUID]):
    model_config = ConfigDict(populate_by_name=True)
    root: UUID

class EntityViewerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['public']

class EntityViewerSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class EntityViewerSubjectItem2(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class EntityViewerSubject(RootModel[EntityViewerSubjectItem | EntityViewerSubjectItem1 | EntityViewerSubjectItem2]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityViewerSubjectItem | EntityViewerSubjectItem1 | EntityViewerSubjectItem2 = Field(..., discriminator='kind')

class ParameterExpression(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    parameter: Any

class KnowledgeGraphEdgeKind(Enum):
    has_left_entity = 'HAS_LEFT_ENTITY'
    has_right_entity = 'HAS_RIGHT_ENTITY'

class LinkOrder(RootModel[int]):
    model_config = ConfigDict(populate_by_name=True)
    root: int

class ModifyRelationshipOperation(Enum):
    """
    Used for mutating a single relationship within the service.
    """
    touch = 'touch'
    create = 'create'
    delete = 'delete'

class NullableTimestamp(RootModel[datetime | None]):
    model_config = ConfigDict(populate_by_name=True)
    root: datetime | None = None

class OntologyEdgeKind(Enum):
    inherits_from = 'INHERITS_FROM'
    constrains_values_on = 'CONSTRAINS_VALUES_ON'
    constrains_properties_on = 'CONSTRAINS_PROPERTIES_ON'
    constrains_links_on = 'CONSTRAINS_LINKS_ON'
    constrains_link_destinations_on = 'CONSTRAINS_LINK_DESTINATIONS_ON'

class OntologyTypeRecordId(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    base_url: str = Field(..., alias='baseUrl')
    version: int = Field(..., ge=0)

class OntologyTypeVersion(RootModel[int]):
    model_config = ConfigDict(populate_by_name=True)
    root: int = Field(..., ge=0)

class UnboundedBound(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['unbounded']

class OutgoingEdgeResolveDepth(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    outgoing: int = Field(..., ge=0)

class OwnedById(RootModel[UUID]):
    model_config = ConfigDict(populate_by_name=True)
    root: UUID

class PermissionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    has_permission: bool

class PropertyTypeOwnerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class PropertyTypeOwnerSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class PropertyTypeOwnerSubject(RootModel[PropertyTypeOwnerSubjectItem | PropertyTypeOwnerSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: PropertyTypeOwnerSubjectItem | PropertyTypeOwnerSubjectItem1 = Field(..., discriminator='kind')

class PropertyTypePermission(Enum):
    update = 'update'
    view = 'view'

class PropertyTypeQueryToken(Enum):
    """
    A single token in a [`DataTypeQueryPath`].
    """
    base_url = 'baseUrl'
    version = 'version'
    versioned_url = 'versionedUrl'
    owned_by_id = 'ownedById'
    record_created_by_id = 'recordCreatedById'
    record_archived_by_id = 'recordArchivedById'
    title = 'title'
    description = 'description'
    data_types = 'dataTypes'
    property_types = 'propertyTypes'

class PropertyTypeRelationAndSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['owner']
    subject: PropertyTypeOwnerSubject

class PropertyTypeViewerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['public']

class PropertyTypeViewerSubject(RootModel[PropertyTypeViewerSubjectItem]):
    model_config = ConfigDict(populate_by_name=True)
    root: PropertyTypeViewerSubjectItem

class PinnedDecisionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: DecisionTime
    timestamp: datetime

class UnresolvedPinnedDecisionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: DecisionTime
    timestamp: NullableTimestamp

class RecordArchivedById(RootModel[UUID]):
    model_config = ConfigDict(populate_by_name=True)
    root: UUID

class RecordCreatedById(RootModel[UUID]):
    model_config = ConfigDict(populate_by_name=True)
    root: UUID

class Selector(RootModel[Literal['*']]):
    model_config = ConfigDict(populate_by_name=True)
    root: Literal['*']

class SharedEdgeKind(RootModel[Literal['IS_OF_TYPE']]):
    model_config = ConfigDict(populate_by_name=True)
    root: Literal['IS_OF_TYPE']

class Timestamp(RootModel[datetime]):
    model_config = ConfigDict(populate_by_name=True)
    root: datetime

class TransactionTime(RootModel[Literal['transactionTime']]):
    model_config = ConfigDict(populate_by_name=True)
    root: Literal['transactionTime'] = Field(..., description='Time axis for the transaction time.\n\nThis is used as the generic argument to time-related structs and can be used as tag value.')

class ValidationOperation(RootModel[Literal['all']]):
    model_config = ConfigDict(populate_by_name=True)
    root: Literal['all']

class WebOwnerSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['account']
    subject_id: AccountId = Field(..., alias='subjectId')

class WebOwnerSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['accountGroup']
    subject_id: AccountGroupId = Field(..., alias='subjectId')

class WebOwnerSubject(RootModel[WebOwnerSubjectItem | WebOwnerSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: WebOwnerSubjectItem | WebOwnerSubjectItem1 = Field(..., discriminator='kind')

class WebPermission(Enum):
    update = 'update'
    create_entity = 'create_entity'
    create_entity_type = 'create_entity_type'
    create_property_type = 'create_property_type'
    create_data_type = 'create_data_type'

class WebRelationAndSubjectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['owner']
    subject: WebOwnerSubject

class WebRelationAndSubject(RootModel[WebRelationAndSubjectItem]):
    model_config = ConfigDict(populate_by_name=True)
    root: WebRelationAndSubjectItem = Field(..., discriminator='relation')

class UpdateDataType(BaseModel):
    """
    The contents of a Data Type update request
    """
    model_config = ConfigDict(extra='allow', populate_by_name=True)
    schema_url: Literal['https://blockprotocol.org/types/modules/graph/0.3/schema/data-type'] = Field(..., alias='$schema')
    kind: Literal['dataType']
    title: str
    description: str | None = None
    type: str

class VersionedURL(RootModel[AnyUrl]):
    model_config = ConfigDict(populate_by_name=True)
    root: AnyUrl = Field(..., description='The versioned URL of a Block Protocol ontology type (the $id of the schema). It should be of the form `${baseUrl}v/${versionNumber}`', max_length=2048, title='Versioned URL')

class DataType(OntologyTypeSchema):
    """
    Specifies the structure of a Data Type
    """
    model_config = ConfigDict(extra='allow', populate_by_name=True)
    schema_url: Literal['https://blockprotocol.org/types/modules/graph/0.3/schema/data-type'] = Field(..., alias='$schema')
    kind: Literal['dataType']
    identifier: VersionedURL = Field(..., alias='$id')
    title: str
    description: str | None = None
    type: str

class BaseURL(RootModel[AnyUrl]):
    model_config = ConfigDict(populate_by_name=True)
    root: AnyUrl = Field(..., description='The base URL of a Block Protocol ontology type (the $id of the schema, without the versioned suffix). It should a valid URL, with a trailing slash.', max_length=2048, title='Base URL')

class DataTypeReference(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    field_ref: VersionedURL = Field(..., alias='$ref')

class EntityTypeReference(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    field_ref: VersionedURL = Field(..., alias='$ref')

class Items1(BaseModel):
    """
    Specifies a set of entity types inside a oneOf
    """
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    one_of: list[EntityTypeReference] | None = Field(None, alias='oneOf')

class LinkTypeObject(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    type: Literal['array']
    ordered: bool
    items: Items1 = Field(..., description='Specifies a set of entity types inside a oneOf')
    min_items: int | None = Field(None, alias='minItems', ge=0)
    max_items: int | None = Field(None, alias='maxItems', ge=0)

class LinkTypeObject1(RootModel[dict[str, LinkTypeObject]]):
    model_config = ConfigDict(populate_by_name=True)
    root: dict[str, LinkTypeObject]

class StatusCode(Enum):
    """
    The canonical status codes for software within the HASH ecosystem.
    Sometimes multiple status codes may apply. Services should return the most specific status code
    that applies. For example, prefer `OutOfRange` over `FailedPrecondition` if both codes
    apply. Similarly prefer `NotFound` or `AlreadyExists` over `FailedPrecondition`.
    """
    aborted = 'ABORTED'
    already_exists = 'ALREADY_EXISTS'
    cancelled = 'CANCELLED'
    data_loss = 'DATA_LOSS'
    deadline_exceeded = 'DEADLINE_EXCEEDED'
    failed_precondition = 'FAILED_PRECONDITION'
    internal = 'INTERNAL'
    invalid_argument = 'INVALID_ARGUMENT'
    not_found = 'NOT_FOUND'
    ok = 'OK'
    out_of_range = 'OUT_OF_RANGE'
    permission_denied = 'PERMISSION_DENIED'
    resource_exhausted = 'RESOURCE_EXHAUSTED'
    unauthenticated = 'UNAUTHENTICATED'
    unavailable = 'UNAVAILABLE'
    unimplemented = 'UNIMPLEMENTED'
    unknown = 'UNKNOWN'

class RecordStringAny(BaseModel):
    """
    Construct a type with a set of properties K of type T
    """
    model_config = ConfigDict(populate_by_name=True)

class ErrorInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    reason: str = Field(..., description='The reason of the error. This is a constant value that identifies the proximate cause of\nthe error. Error reasons are unique within a particular domain of errors. This should be at\nmost 63 characters and match a regular expression of `[A-Z][A-Z0-9_]+[A-Z0-9]`, which\nrepresents UPPER_SNAKE_CASE.', title='reason')
    domain: str = Field(..., description='The logical grouping to which the "reason" belongs.\nThe error domain is typically the registered service name of the tool or product that\ngenerates the error.', title='domain')
    metadata: RecordStringAny = Field(..., description='Additional structured details about this error.\n\nKeys should match /[a-zA-Z0-9-_]/ and be limited to 64 characters in length. When\nidentifying the current value of an exceeded limit, the units should be contained in the\nkey, not the value.  For example, rather than {"instanceLimit": "100/request"}, should be\nreturned as, {"instanceLimitPerRequest": "100"}, if the client exceeds the number of\ninstances that can be created in a single (batch) request.', title='metadata')

class RequestInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    request_id: str = Field(..., alias='requestId', description="An opaque string that should only be interpreted by the service generating it. For example, it\ncan be used to identify requests in the service's logs.", title='requestId')
    serving_data: str = Field(..., alias='servingData', description='Any data that was used to serve this request. For example, an encrypted stack trace that can be\nsent back to the service provider for debugging.', title='servingData')

class ResourceInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    resource_type: str = Field(..., alias='resourceType', description='A name for the type of resource being accessed.\n\nFor example "SQL table", "Entity", "Property Type", "Redis"; or the type URL of the resource:\ne.g. "https://blockprotocol.org/type-system/0.3/schema/meta/entity-type".', title='resourceType')
    resource_name: str = Field(..., alias='resourceName', description='The name of the resource being accessed.\n\nFor example, an ontology type ID: `https://hash.ai/@alice/types/entity-type/Person/`, if the current\nerror is [@local/status/StatusCode.PermissionDenied].', title='resourceName')
    owner: str | None = Field(None, description="The owner of the resource (optional).\n\nFor example, a User's entity ID: `2cfa262a-f49a-4a61-a9c5-80a0c5959994%45e528cb-801d-49d1-8f71-d9e2af38a5e7`;", title='owner')
    description: str = Field(..., description="Describes what error is encountered when accessing this resource.\n\nFor example, updating a property on a user's entity may require write permission on that property.", title='description')

class Status(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: StatusCode = Field(..., title='code')
    message: str | None = Field(None, description='A developer-facing description of the status.\n\nWhere possible, this should provide guiding advice for debugging and/or handling the error.')
    contents: list[ErrorInfo | RequestInfo | ResourceInfo]

class PropertyObjectReference(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    field_ref: BaseURL = Field(..., alias='$ref')

class ArchiveDataTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type_to_archive: VersionedURL = Field(..., alias='typeToArchive')

class ArchiveEntityTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type_to_archive: VersionedURL = Field(..., alias='typeToArchive')

class ArchivePropertyTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type_to_archive: VersionedURL = Field(..., alias='typeToArchive')

class InclusiveBound(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['inclusive']
    limit: Timestamp

class ClosedTemporalBound(RootModel[InclusiveBound]):
    model_config = ConfigDict(populate_by_name=True)
    root: InclusiveBound = Field(..., discriminator='kind')

class CreateDataTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    owned_by_id: OwnedById = Field(..., alias='ownedById')
    schema_: DataType | list[DataType] = Field(..., alias='schema')

class CreateWebRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    owned_by_id: OwnedById = Field(..., alias='ownedById')
    owner: WebOwnerSubject

class DataTypeRelationAndSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['viewer']
    subject: DataTypeViewerSubject

class DataTypeRelationAndSubject(RootModel[DataTypeRelationAndSubjectItem | DataTypeRelationAndSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: DataTypeRelationAndSubjectItem | DataTypeRelationAndSubjectItem1 = Field(..., discriminator='relation')

class DataTypeVertexId(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    base_id: BaseURL = Field(..., alias='baseId')
    revision_id: OntologyTypeVersion = Field(..., alias='revisionId')

class EntityLinkOrder(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    left_to_right_order: LinkOrder | None = Field(None, alias='leftToRightOrder')
    right_to_left_order: LinkOrder | None = Field(None, alias='rightToLeftOrder')

class EntityRelationAndSubjectItem2(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['viewer']
    subject: EntityViewerSubject

class EntityRelationAndSubject(RootModel[EntityRelationAndSubjectItem | EntityRelationAndSubjectItem1 | EntityRelationAndSubjectItem2]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityRelationAndSubjectItem | EntityRelationAndSubjectItem1 | EntityRelationAndSubjectItem2 = Field(..., discriminator='relation')

class EntityTypeRelationAndSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['viewer']
    subject: EntityTypeViewerSubject

class EntityTypeRelationAndSubject(RootModel[EntityTypeRelationAndSubjectItem | EntityTypeRelationAndSubjectItem1 | EntityTypeRelationAndSubjectItem2]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityTypeRelationAndSubjectItem | EntityTypeRelationAndSubjectItem1 | EntityTypeRelationAndSubjectItem2 = Field(..., discriminator='relation')

class EntityTypeVertexId(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    base_id: BaseURL = Field(..., alias='baseId')
    revision_id: OntologyTypeVersion = Field(..., alias='revisionId')

class EntityVertexId(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    base_id: EntityId = Field(..., alias='baseId')
    revision_id: Timestamp = Field(..., alias='revisionId')

class PathExpression(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    path: list[DataTypeQueryToken | PropertyTypeQueryToken | EntityTypeQueryToken | EntityQueryToken | Selector | str | float]

class FilterExpression(RootModel[PathExpression | ParameterExpression]):
    model_config = ConfigDict(populate_by_name=True)
    root: PathExpression | ParameterExpression

class GraphResolveDepths(BaseModel):
    """
    TODO: DOC - <https://app.asana.com/0/0/1203438518991188/f>
    """
    model_config = ConfigDict(populate_by_name=True)
    constrains_link_destinations_on: OutgoingEdgeResolveDepth = Field(..., alias='constrainsLinkDestinationsOn')
    constrains_links_on: OutgoingEdgeResolveDepth = Field(..., alias='constrainsLinksOn')
    constrains_properties_on: OutgoingEdgeResolveDepth = Field(..., alias='constrainsPropertiesOn')
    constrains_values_on: OutgoingEdgeResolveDepth = Field(..., alias='constrainsValuesOn')
    has_left_entity: EdgeResolveDepths = Field(..., alias='hasLeftEntity')
    has_right_entity: EdgeResolveDepths = Field(..., alias='hasRightEntity')
    inherits_from: OutgoingEdgeResolveDepth = Field(..., alias='inheritsFrom')
    is_of_type: OutgoingEdgeResolveDepth = Field(..., alias='isOfType')

class ExclusiveBound(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: Literal['exclusive']
    limit: Timestamp

class LimitedTemporalBound(RootModel[InclusiveBound | ExclusiveBound]):
    model_config = ConfigDict(populate_by_name=True)
    root: InclusiveBound | ExclusiveBound = Field(..., discriminator='kind')

class LinkData(EntityLinkOrder):
    """
    The associated information for 'Link' entities
    """
    model_config = ConfigDict(populate_by_name=True)
    left_entity_id: EntityId = Field(..., alias='leftEntityId')
    right_entity_id: EntityId = Field(..., alias='rightEntityId')

class LoadExternalDataTypeRequestItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    data_type_id: VersionedURL = Field(..., alias='dataTypeId')

class LoadExternalDataTypeRequestItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    schema_: DataType = Field(..., alias='schema')

class LoadExternalDataTypeRequest(RootModel[LoadExternalDataTypeRequestItem | LoadExternalDataTypeRequestItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: LoadExternalDataTypeRequestItem | LoadExternalDataTypeRequestItem1

class LoadExternalEntityTypeRequestItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    entity_type_id: VersionedURL = Field(..., alias='entityTypeId')

class LoadExternalPropertyTypeRequestItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    property_type_id: VersionedURL = Field(..., alias='propertyTypeId')

class ModifyDataTypeAuthorizationRelationship(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    operation: ModifyRelationshipOperation
    relation_and_subject: DataTypeRelationAndSubject = Field(..., alias='relationAndSubject')
    resource: VersionedURL

class ModifyEntityAuthorizationRelationship(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    operation: ModifyRelationshipOperation
    relation_subject: EntityRelationAndSubject = Field(..., alias='relationSubject')
    resource: EntityId

class ModifyEntityTypeAuthorizationRelationship(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    operation: ModifyRelationshipOperation
    relation_and_subject: EntityTypeRelationAndSubject = Field(..., alias='relationAndSubject')
    resource: VersionedURL

class ModifyWebAuthorizationRelationship(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    operation: ModifyRelationshipOperation
    relation_and_subject: WebRelationAndSubject = Field(..., alias='relationAndSubject')
    resource: OwnedById

class OpenTemporalBound(RootModel[ExclusiveBound | UnboundedBound]):
    model_config = ConfigDict(populate_by_name=True)
    root: ExclusiveBound | UnboundedBound = Field(..., discriminator='kind')

class PropertyTypeRelationAndSubjectItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    relation: Literal['viewer']
    subject: PropertyTypeViewerSubject

class PropertyTypeRelationAndSubject(RootModel[PropertyTypeRelationAndSubjectItem | PropertyTypeRelationAndSubjectItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: PropertyTypeRelationAndSubjectItem | PropertyTypeRelationAndSubjectItem1 = Field(..., discriminator='relation')

class PropertyTypeVertexId(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    base_id: BaseURL = Field(..., alias='baseId')
    revision_id: OntologyTypeVersion = Field(..., alias='revisionId')

class ProvenanceMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    record_archived_by_id: RecordArchivedById | None = Field(None, alias='recordArchivedById')
    record_created_by_id: RecordCreatedById = Field(..., alias='recordCreatedById')

class PinnedTransactionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: TransactionTime
    timestamp: datetime

class UnresolvedPinnedTransactionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: TransactionTime
    timestamp: NullableTimestamp

class TemporalBound(RootModel[UnboundedBound | InclusiveBound | ExclusiveBound]):
    model_config = ConfigDict(populate_by_name=True)
    root: UnboundedBound | InclusiveBound | ExclusiveBound = Field(..., discriminator='kind')

class UnarchiveDataTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type_to_unarchive: VersionedURL = Field(..., alias='typeToUnarchive')

class UnarchiveEntityTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type_to_unarchive: VersionedURL = Field(..., alias='typeToUnarchive')

class UnarchivePropertyTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type_to_unarchive: VersionedURL = Field(..., alias='typeToUnarchive')

class UnresolvedRightBoundedTemporalInterval(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    end: LimitedTemporalBound | None = Field(...)
    start: TemporalBound | None = Field(...)

class UpdateDataTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    schema_: UpdateDataType = Field(..., alias='schema')
    type_to_update: VersionedURL = Field(..., alias='typeToUpdate')

class UpdateEntityRequest(EntityLinkOrder):
    model_config = ConfigDict(populate_by_name=True)
    archived: bool
    draft: bool
    entity_id: EntityId = Field(..., alias='entityId')
    entity_type_id: VersionedURL = Field(..., alias='entityTypeId')
    properties: EntityProperties

class ValidateEntityRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    entity_type_id: VersionedURL = Field(..., alias='entityTypeId')
    link_data: LinkData | None = Field(None, alias='linkData')
    operations: list[ValidationOperation]
    properties: EntityProperties

class PropertyTypeObjectItem(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    type: Literal['array']
    items: PropertyObjectReference
    min_items: int | None = Field(None, alias='minItems', ge=0)
    max_items: int | None = Field(None, alias='maxItems', ge=0)

class PropertyTypeObject(RootModel[dict[str, PropertyObjectReference | PropertyTypeObjectItem]]):
    model_config = ConfigDict(populate_by_name=True)
    root: dict[str, PropertyObjectReference | PropertyTypeObjectItem] = Field(..., description='A JSON object where each entry is constrained by a property type.', title='Property Type Object')

class PropertyObjectValue(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    type: Literal['object']
    properties: PropertyTypeObject

class EntityType(OntologyTypeSchema):
    """
    Specifies the structure of a Block Protocol entity type
    """
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    schema_url: Literal['https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type'] = Field(..., alias='$schema')
    kind: Literal['entityType']
    identifier: VersionedURL = Field(..., alias='$id')
    type: Literal['object']
    title: str
    description: str | None = None
    all_of: list[EntityTypeReference] | None = Field(None, alias='allOf')
    examples: list[dict[str, Any]] | None = None
    properties: PropertyTypeObject
    required: list[BaseURL] | None = None
    links: LinkTypeObject1 | None = None

class UpdateEntityType(BaseModel):
    """
    The contents of an Entity Type update request
    """
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    schema_url: Literal['https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type'] = Field(..., alias='$schema')
    kind: Literal['entityType']
    type: Literal['object']
    title: str
    description: str | None = None
    examples: list[dict[str, Any]] | None = None
    properties: PropertyTypeObject
    required: list[BaseURL] | None = None
    links: LinkTypeObject1 | None = None

class CreateEntityRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    draft: bool
    entity_type_id: VersionedURL = Field(..., alias='entityTypeId')
    entity_uuid: EntityUuid | None = Field(None, alias='entityUuid')
    link_data: LinkData | None = Field(None, alias='linkData')
    owned_by_id: OwnedById = Field(..., alias='ownedById')
    owner: OwnedById
    properties: EntityProperties

class CreateEntityTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    icon: str | None = None
    label_property: BaseURL | None = Field(None, alias='labelProperty')
    owned_by_id: OwnedById = Field(..., alias='ownedById')
    schema_: EntityType | list[EntityType] = Field(..., alias='schema')

class EqualFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    equal: list[FilterExpression] = Field(..., max_length=2, min_length=2)

class NotEqualFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    not_equal: list[FilterExpression] = Field(..., alias='notEqual', max_length=2, min_length=2)

class StartsWithFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    starts_with: list[FilterExpression] = Field(..., alias='startsWith', max_length=2, min_length=2)

class EndsWithFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    ends_with: list[FilterExpression] = Field(..., alias='endsWith', max_length=2, min_length=2)

class ContainsSegmentFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    contains_segment: list[FilterExpression] = Field(..., alias='containsSegment', max_length=2, min_length=2)

class GraphElementVertexId(RootModel[DataTypeVertexId | PropertyTypeVertexId | EntityTypeVertexId | EntityVertexId]):
    model_config = ConfigDict(populate_by_name=True)
    root: DataTypeVertexId | PropertyTypeVertexId | EntityTypeVertexId | EntityVertexId

class LeftClosedTemporalInterval(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    end: OpenTemporalBound
    start: ClosedTemporalBound

class LoadExternalEntityTypeRequestItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    icon: str | None = None
    label_property: BaseURL | None = None
    schema_: EntityType = Field(..., alias='schema')

class LoadExternalEntityTypeRequest(RootModel[LoadExternalEntityTypeRequestItem | LoadExternalEntityTypeRequestItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: LoadExternalEntityTypeRequestItem | LoadExternalEntityTypeRequestItem1

class ModifyPropertyTypeAuthorizationRelationship(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    operation: ModifyRelationshipOperation
    relation_and_subject: PropertyTypeRelationAndSubject = Field(..., alias='relationAndSubject')
    resource: VersionedURL

class OntologyTemporalMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    transaction_time: LeftClosedTemporalInterval = Field(..., alias='transactionTime')

class OntologyTypeVertexId(RootModel[DataTypeVertexId | PropertyTypeVertexId | EntityTypeVertexId]):
    model_config = ConfigDict(populate_by_name=True)
    root: DataTypeVertexId | PropertyTypeVertexId | EntityTypeVertexId

class UnresolvedVariableDecisionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: DecisionTime
    interval: UnresolvedRightBoundedTemporalInterval

class QueryTemporalAxesUnresolvedDecisionTime(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pinned: UnresolvedPinnedTransactionAxis = Field(..., title='UnresolvedPinnedTransactionAxis')
    variable: UnresolvedVariableDecisionAxis = Field(..., title='UnresolvedVariableDecisionAxis')

class UnresolvedVariableTransactionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: TransactionTime
    interval: UnresolvedRightBoundedTemporalInterval

class QueryTemporalAxesUnresolvedTransactionTime(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pinned: UnresolvedPinnedDecisionAxis = Field(..., title='UnresolvedPinnedDecisionAxis')
    variable: UnresolvedVariableTransactionAxis = Field(..., title='UnresolvedVariableTransactionAxis')

class QueryTemporalAxesUnresolved(RootModel[QueryTemporalAxesUnresolvedDecisionTime | QueryTemporalAxesUnresolvedTransactionTime]):
    model_config = ConfigDict(populate_by_name=True)
    root: QueryTemporalAxesUnresolvedDecisionTime | QueryTemporalAxesUnresolvedTransactionTime = Field(..., description='Defines the two possible combinations of pinned/variable temporal axes that are used in queries\nthat return [`Subgraph`]s.\n\nThe [`VariableTemporalAxisUnresolved`] is optionally bounded, in the absence of provided\nbounds an inclusive bound at the timestamp at point of resolving is assumed.\n\n[`Subgraph`]: crate::subgraph::Subgraph')

class RightBoundedTemporalInterval(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    end: LimitedTemporalBound
    start: TemporalBound

class UpdateEntityTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    icon: str | None = None
    label_property: BaseURL | None = Field(None, alias='labelProperty')
    schema_: UpdateEntityType = Field(..., alias='schema')
    type_to_update: VersionedURL = Field(..., alias='typeToUpdate')

class CustomOwnedOntologyElementMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    owned_by_id: OwnedById = Field(..., alias='ownedById')
    provenance: ProvenanceMetadata
    temporal_versioning: OntologyTemporalMetadata = Field(..., alias='temporalVersioning')

class CustomExternalOntologyElementMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    fetched_at: str = Field(..., alias='fetchedAt')
    provenance: ProvenanceMetadata
    temporal_versioning: OntologyTemporalMetadata = Field(..., alias='temporalVersioning')

class CustomOntologyMetadata(RootModel[CustomOwnedOntologyElementMetadata | CustomExternalOntologyElementMetadata]):
    model_config = ConfigDict(populate_by_name=True)
    root: CustomOwnedOntologyElementMetadata | CustomExternalOntologyElementMetadata

class EntityIdWithInterval(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    entity_id: EntityId = Field(..., alias='entityId')
    interval: LeftClosedTemporalInterval

class EntityTemporalMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    decision_time: LeftClosedTemporalInterval = Field(..., alias='decisionTime')
    transaction_time: LeftClosedTemporalInterval = Field(..., alias='transactionTime')

class EntityTypeMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    custom: CustomOntologyMetadata
    icon: str | None = None
    label_property: BaseURL | None = Field(None, alias='labelProperty')
    record_id: OntologyTypeRecordId = Field(..., alias='recordId')

class EntityTypeWithMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    metadata: EntityTypeMetadata
    schema_: EntityType = Field(..., alias='schema')

class KnowledgeGraphToKnowledgeGraphOutwardEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: KnowledgeGraphEdgeKind
    reversed: bool
    right_endpoint: EntityIdWithInterval = Field(..., alias='rightEndpoint')

class KnowledgeGraphToOntologyOutwardEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: SharedEdgeKind
    reversed: bool
    right_endpoint: OntologyTypeVertexId = Field(..., alias='rightEndpoint')

class KnowledgeGraphOutwardEdge(RootModel[KnowledgeGraphToKnowledgeGraphOutwardEdge | KnowledgeGraphToOntologyOutwardEdge]):
    model_config = ConfigDict(populate_by_name=True)
    root: KnowledgeGraphToKnowledgeGraphOutwardEdge | KnowledgeGraphToOntologyOutwardEdge

class MaybeListOfEntityTypeMetadata(RootModel[EntityTypeMetadata | list[EntityTypeMetadata]]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityTypeMetadata | list[EntityTypeMetadata]

class OntologyElementMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    custom: CustomOntologyMetadata
    record_id: OntologyTypeRecordId = Field(..., alias='recordId')

class OntologyToOntologyOutwardEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: OntologyEdgeKind
    reversed: bool
    right_endpoint: OntologyTypeVertexId = Field(..., alias='rightEndpoint')

class OntologyToKnowledgeGraphOutwardEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: SharedEdgeKind
    reversed: bool
    right_endpoint: EntityIdWithInterval = Field(..., alias='rightEndpoint')

class OntologyOutwardEdge(RootModel[OntologyToOntologyOutwardEdge | OntologyToKnowledgeGraphOutwardEdge]):
    model_config = ConfigDict(populate_by_name=True)
    root: OntologyToOntologyOutwardEdge | OntologyToKnowledgeGraphOutwardEdge

class EntityTypeVertex(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    inner: EntityTypeWithMetadata
    kind: Literal['entityType']

class VariableDecisionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: DecisionTime
    interval: RightBoundedTemporalInterval

class QueryTemporalAxesDecisionTime(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pinned: PinnedTransactionAxis = Field(..., title='PinnedTransactionAxis')
    variable: VariableDecisionAxis = Field(..., title='VariableDecisionAxis')

class VariableTransactionAxis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    axis: TransactionTime
    interval: RightBoundedTemporalInterval

class QueryTemporalAxesTransactionTime(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pinned: PinnedDecisionAxis = Field(..., title='PinnedDecisionAxis')
    variable: VariableTransactionAxis = Field(..., title='VariableTransactionAxis')

class QueryTemporalAxes(RootModel[QueryTemporalAxesDecisionTime | QueryTemporalAxesTransactionTime]):
    model_config = ConfigDict(populate_by_name=True)
    root: QueryTemporalAxesDecisionTime | QueryTemporalAxesTransactionTime = Field(..., description='Defines the two possible combinations of pinned/variable temporal axes that are used in\nresponses to queries that return [`Subgraph`]s.\n\nWhen querying the Graph, temporal data is returned. The Graph is implemented as a bitemporal\ndata store, which means the knowledge data contains information about the time of when the\nknowledge was inserted into the Graph, the [`TransactionTime`], and when the knowledge was\ndecided to be inserted, the [`DecisionTime`].\n\nIn order to query data from the Graph, only one of the two time axes can be used. This is\nachieved by using a `TemporalAxes`. The `TemporalAxes` pins one axis to a specified\n[`Timestamp`], while the other axis can be a [`Interval`]. The pinned axis is called the\n[`PinnedTemporalAxis`] and the other axis is called the [`VariableTemporalAxis`]. The returned\ndata will then only contain temporal data that is contained in the [`Interval`] of the\n[`VariableTemporalAxis`] for the given [`Timestamp`] of the [`PinnedTemporalAxis`].\n\n[`Subgraph`]: crate::subgraph::Subgraph\n[`Interval`]: temporal_versioning::Interval')

class SubgraphTemporalAxes(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    initial: QueryTemporalAxesUnresolved
    resolved: QueryTemporalAxes

class DataTypeWithMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    metadata: OntologyElementMetadata
    schema_: DataType = Field(..., alias='schema')

class Edges(RootModel[dict[str, dict[str, list[OntologyOutwardEdge | KnowledgeGraphOutwardEdge]]] | None]):
    model_config = ConfigDict(populate_by_name=True)
    root: dict[str, dict[str, list[OntologyOutwardEdge | KnowledgeGraphOutwardEdge]]] | None = None

class EntityMetadata(BaseModel):
    """
    The metadata of an [`Entity`] record.
    """
    model_config = ConfigDict(populate_by_name=True)
    archived: bool
    draft: bool
    entity_type_id: str = Field(..., alias='entityTypeId')
    provenance: ProvenanceMetadata
    record_id: EntityRecordId = Field(..., alias='recordId')
    temporal_versioning: EntityTemporalMetadata = Field(..., alias='temporalVersioning')

class MaybeListOfOntologyElementMetadata(RootModel[OntologyElementMetadata | list[OntologyElementMetadata]]):
    model_config = ConfigDict(populate_by_name=True)
    root: OntologyElementMetadata | list[OntologyElementMetadata]

class DataTypeVertex(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    inner: DataTypeWithMetadata
    kind: Literal['dataType']

class Entity(BaseModel):
    """
    A record of an [`Entity`] that has been persisted in the datastore, with its associated
    metadata.
    """
    model_config = ConfigDict(populate_by_name=True)
    link_data: LinkData | None = Field(None, alias='linkData')
    metadata: EntityMetadata
    properties: EntityProperties

class EntityVertex(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    inner: Entity
    kind: Literal['entity']

class KnowledgeGraphVertex(RootModel[EntityVertex]):
    model_config = ConfigDict(populate_by_name=True)
    root: EntityVertex = Field(..., discriminator='kind')

class KnowledgeGraphVertices(RootModel[dict[str, dict[str, KnowledgeGraphVertex]] | None]):
    model_config = ConfigDict(populate_by_name=True)
    root: dict[str, dict[str, KnowledgeGraphVertex]] | None = None

class CreatePropertyTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    owned_by_id: OwnedById = Field(..., alias='ownedById')
    schema_: PropertyType | list[PropertyType] = Field(..., alias='schema')

class DataTypeStructuralQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    filter: Filter
    graph_resolve_depths: GraphResolveDepths = Field(..., alias='graphResolveDepths')
    temporal_axes: QueryTemporalAxesUnresolved = Field(..., alias='temporalAxes')

class EntityStructuralQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    filter: Filter
    graph_resolve_depths: GraphResolveDepths = Field(..., alias='graphResolveDepths')
    temporal_axes: QueryTemporalAxesUnresolved = Field(..., alias='temporalAxes')

class EntityTypeStructuralQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    filter: Filter
    graph_resolve_depths: GraphResolveDepths = Field(..., alias='graphResolveDepths')
    temporal_axes: QueryTemporalAxesUnresolved = Field(..., alias='temporalAxes')

class AllFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    all: list[Filter]

class AnyFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    any: list[Filter]

class NotFilter(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    not_: Filter = Field(..., alias='not')

class Filter(RootModel[AllFilter | AnyFilter | NotFilter | EqualFilter | NotEqualFilter | StartsWithFilter | EndsWithFilter | ContainsSegmentFilter]):
    model_config = ConfigDict(populate_by_name=True)
    root: AllFilter | AnyFilter | NotFilter | EqualFilter | NotEqualFilter | StartsWithFilter | EndsWithFilter | ContainsSegmentFilter

class LoadExternalPropertyTypeRequestItem1(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    schema_: PropertyType = Field(..., alias='schema')

class LoadExternalPropertyTypeRequest(RootModel[LoadExternalPropertyTypeRequestItem | LoadExternalPropertyTypeRequestItem1]):
    model_config = ConfigDict(populate_by_name=True)
    root: LoadExternalPropertyTypeRequestItem | LoadExternalPropertyTypeRequestItem1

class PropertyTypeVertex(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    inner: PropertyTypeWithMetadata
    kind: Literal['propertyType']

class OntologyVertex(RootModel[DataTypeVertex | PropertyTypeVertex | EntityTypeVertex]):
    model_config = ConfigDict(populate_by_name=True)
    root: DataTypeVertex | PropertyTypeVertex | EntityTypeVertex = Field(..., discriminator='kind')

class OntologyVertices(RootModel[dict[str, dict[str, OntologyVertex]] | None]):
    model_config = ConfigDict(populate_by_name=True)
    root: dict[str, dict[str, OntologyVertex]] | None = None

class PropertyTypeStructuralQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    filter: Filter
    graph_resolve_depths: GraphResolveDepths = Field(..., alias='graphResolveDepths')
    temporal_axes: QueryTemporalAxesUnresolved = Field(..., alias='temporalAxes')

class PropertyTypeWithMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    metadata: OntologyElementMetadata
    schema_: PropertyType = Field(..., alias='schema')

class Subgraph(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    depths: GraphResolveDepths
    edges: Edges
    roots: list[GraphElementVertexId]
    temporal_axes: SubgraphTemporalAxes = Field(..., alias='temporalAxes')
    vertices: Vertices

class UpdatePropertyTypeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    schema_: UpdatePropertyType = Field(..., alias='schema')
    type_to_update: VersionedURL = Field(..., alias='typeToUpdate')

class Vertex(RootModel[OntologyVertex | KnowledgeGraphVertex]):
    model_config = ConfigDict(populate_by_name=True)
    root: OntologyVertex | KnowledgeGraphVertex

class Vertices(RootModel[dict[str, dict[str, KnowledgeGraphVertex | OntologyVertex]] | None]):
    model_config = ConfigDict(populate_by_name=True)
    root: dict[str, dict[str, KnowledgeGraphVertex | OntologyVertex]] | None = None

class Items(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    one_of: list[PropertyValues] = Field(..., alias='oneOf', min_length=1)

class PropertyArrayValue(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    type: Literal['array']
    items: Items
    min_items: int | None = Field(None, alias='minItems', ge=0)
    max_items: int | None = Field(None, alias='maxItems', ge=0)

class PropertyValues(RootModel[DataTypeReference | PropertyObjectValue | PropertyArrayValue]):
    model_config = ConfigDict(populate_by_name=True)
    root: DataTypeReference | PropertyObjectValue | PropertyArrayValue = Field(..., description='The definition of potential property values, either references to data types, objects made up of more property types, or an array where the items are defined from a set of other property values definitions.', title='propertyValues')

class PropertyType(OntologyTypeSchema):
    """
    Specifies the structure of a Block Protocol property type
    """
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    schema_url: Literal['https://blockprotocol.org/types/modules/graph/0.3/schema/property-type'] = Field(..., alias='$schema')
    kind: Literal['propertyType']
    identifier: VersionedURL = Field(..., alias='$id')
    title: str
    description: str | None = None
    one_of: list[PropertyValues] = Field(..., alias='oneOf')

class UpdatePropertyType(BaseModel):
    """
    The contents of a Property Type update request
    """
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    schema_url: Literal['https://blockprotocol.org/types/modules/graph/0.3/schema/property-type'] = Field(..., alias='$schema')
    kind: Literal['propertyType']
    title: str
    description: str | None = None
    one_of: list[PropertyValues] = Field(..., alias='oneOf')
CreatePropertyTypeRequest.model_rebuild()
DataTypeStructuralQuery.model_rebuild()
EntityStructuralQuery.model_rebuild()
EntityTypeStructuralQuery.model_rebuild()
AllFilter.model_rebuild()
AnyFilter.model_rebuild()
NotFilter.model_rebuild()
LoadExternalPropertyTypeRequestItem1.model_rebuild()
PropertyTypeVertex.model_rebuild()
PropertyTypeWithMetadata.model_rebuild()
Subgraph.model_rebuild()
UpdatePropertyTypeRequest.model_rebuild()
Items.model_rebuild()