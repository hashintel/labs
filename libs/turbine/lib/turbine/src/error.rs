use onlyerror::Error;

#[derive(Debug, Copy, Clone, Error)]
pub enum GenericPropertyError {
    #[error("unable to convert value into data-type")]
    Data,
    #[error("unable to convert one or values in array")]
    Array,
    #[error("expected array as value")]
    ExpectedArray,
    #[error("expected property with key {0} in object")]
    ExpectedProperty(&'static str),
    #[error("unable to convert value of property {0}")]
    Property(&'static str),
    #[error("expected object as value")]
    ExpectedObject,
    #[error("invalid value")]
    InvalidValue,
}

#[derive(Debug, Copy, Clone, Error)]
pub enum GenericEntityError {
    #[error("unable to convert one or values in array")]
    Array,
    #[error("expected array as value at {0}")]
    ExpectedArray(&'static str),
    #[error("expected property with key {0} in object")]
    ExpectedProperty(&'static str),
    #[error("unable to convert value of property {0}")]
    Property(&'static str),
    #[error("expected `LinkData`")]
    ExpectedLinkData,
}
